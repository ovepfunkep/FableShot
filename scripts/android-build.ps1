param(
    [string[]] $Tasks = @('assembleDebug'),
    [switch] $Stacktrace
)
$ErrorActionPreference = 'Stop'
$assembleApks = [bool]($Tasks -match '(^|:)assemble(Debug|Verification)?$')
if ($assembleApks -and -not ($Tasks -match '(^|:)assemble$')) {
    foreach ($task in @('assembleDebug', 'assembleVerification')) {
        if (-not ($Tasks -match "(^|:)$task$")) { $Tasks += $task }
    }
}
$androidProjectRoot = Split-Path -Parent $PSScriptRoot
$androidConfigPath = Join-Path $androidProjectRoot '.tools\android-toolchain.json'
if (-not (Test-Path -LiteralPath $androidConfigPath)) {
    throw 'Local Android toolchain configuration is missing. See docs/android-development-workflow.md.'
}
$androidToolchain = Get-Content -Raw -LiteralPath $androidConfigPath | ConvertFrom-Json
$env:JAVA_HOME = $androidToolchain.JdkHome
$env:ANDROID_HOME = $androidToolchain.SdkRoot
$env:GRADLE_USER_HOME = $androidToolchain.GradleUserHome
$env:ANDROID_USER_HOME = Join-Path $androidToolchain.ToolchainRoot 'android-user'
$androidJava = Join-Path $androidToolchain.JdkHome 'bin\java.exe'
$androidGradleLauncher = Join-Path $androidToolchain.GradleHome 'lib\gradle-gradle-cli-main-9.3.1.jar'
$androidSourceRoot = [IO.Path]::GetFullPath((Join-Path $androidProjectRoot 'android'))
$androidToolchainRoot = [IO.Path]::GetFullPath($androidToolchain.ToolchainRoot)
$androidBuildRoot = [IO.Path]::GetFullPath((Join-Path $androidToolchainRoot 'project'))
# /MIR only targets this dedicated build copy, never the source checkout.
if (-not $androidBuildRoot.StartsWith($androidToolchainRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
    $androidBuildRoot -eq $androidSourceRoot -or $androidBuildRoot -match '[^\x00-\x7F]') {
    throw 'Build mirror must be a dedicated ASCII directory inside the configured toolchain.'
}
New-Item -ItemType Directory -Path $androidBuildRoot -Force | Out-Null
& robocopy.exe $androidSourceRoot $androidBuildRoot /MIR /XD .gradle build /XF local.properties /R:1 /W:1 /NFL /NDL /NJH /NJS
if ($LASTEXITCODE -gt 7) { throw 'Could not synchronise Android build mirror.' }
$androidFixtureRoot = Join-Path $androidToolchainRoot 'test-fixtures'
New-Item -ItemType Directory -Path $androidFixtureRoot -Force | Out-Null
foreach ($androidFixtureName in @('mytargets-sample.csv','cg3-cases.json')) {
    Copy-Item -LiteralPath (Join-Path $androidProjectRoot "docs\fixtures\$androidFixtureName") -Destination (Join-Path $androidFixtureRoot $androidFixtureName) -Force
}
[IO.File]::WriteAllText((Join-Path $androidBuildRoot 'local.properties'), ('sdk.dir=' + $androidToolchain.SdkRoot.Replace('\','/') + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
$androidArguments = @('-p', $androidBuildRoot, '--console=plain', "-PfableshotFixtures=$androidFixtureRoot") + $Tasks
if ($Stacktrace) { $androidArguments += '--stacktrace' }
Push-Location -LiteralPath $androidBuildRoot
try {
    & $androidJava '-Xmx64m' '-Xms64m' '-Dfile.encoding=UTF-8' '-jar' $androidGradleLauncher @androidArguments
    $androidBuildExit = $LASTEXITCODE
} finally { Pop-Location }
# Preserve successful KSP schema output even if a later test/compile task fails.
# Otherwise the next mirror synchronisation removes it while Gradle may cache KSP.
$androidGeneratedSchemas = Join-Path $androidBuildRoot 'app\schemas'
if (Test-Path -LiteralPath $androidGeneratedSchemas) {
    New-Item -ItemType Directory -Path (Join-Path $androidSourceRoot 'app\schemas') -Force | Out-Null
    Get-ChildItem -LiteralPath $androidGeneratedSchemas | Copy-Item -Destination (Join-Path $androidSourceRoot 'app\schemas') -Recurse -Force
}
if ($androidBuildExit -ne 0) { exit $androidBuildExit }
if ($assembleApks) {
    $apkVariants = @(
        @{ Variant = 'debug'; Package = 'app.fableshot.android.dev'; Name = 'FableShot-debug.apk' }
        @{ Variant = 'verification'; Package = 'app.fableshot.android.verification'; Name = 'FableShot-test.apk' }
    )
    $builtApks = foreach ($apk in $apkVariants) {
        $outputDir = Join-Path $androidBuildRoot "app\build\outputs\apk\$($apk.Variant)"
        $metadata = Get-Content -Raw -LiteralPath (Join-Path $outputDir 'output-metadata.json') | ConvertFrom-Json
        $output = $metadata.elements[0]
        if ($metadata.applicationId -ne $apk.Package -or $metadata.elements.Count -ne 1 -or
            $output.outputFile -ne "app-$($apk.Variant).apk" -or -not $output.versionName -or -not $output.versionCode) {
            throw "Unexpected $($apk.Variant) APK metadata"
        }
        $path = Join-Path $outputDir $output.outputFile
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing $($apk.Variant) APK" }
        [pscustomobject]@{ Path = $path; Name = $apk.Name; VersionName = $output.versionName; VersionCode = $output.versionCode }
    }
    if ($builtApks[0].VersionName -ne $builtApks[1].VersionName -or $builtApks[0].VersionCode -ne $builtApks[1].VersionCode) {
        throw 'The regular and test APKs must have the same version name and code.'
    }
    $artifactsDir = Join-Path $androidProjectRoot 'artifacts'
    New-Item -ItemType Directory -Path $artifactsDir -Force | Out-Null
    foreach ($apk in $builtApks) {
        Copy-Item -LiteralPath $apk.Path -Destination (Join-Path $artifactsDir $apk.Name) -Force
    }
}
foreach ($androidWrapperName in @('gradlew','gradlew.bat','gradle\wrapper\gradle-wrapper.jar','gradle\wrapper\gradle-wrapper.properties')) {
    $androidWrapperSource = Join-Path $androidBuildRoot $androidWrapperName
    if (Test-Path -LiteralPath $androidWrapperSource) {
        $androidWrapperDestination = Join-Path $androidSourceRoot $androidWrapperName
        New-Item -ItemType Directory -Path (Split-Path -Parent $androidWrapperDestination) -Force | Out-Null
        Copy-Item -LiteralPath $androidWrapperSource -Destination $androidWrapperDestination -Force
    }
}
