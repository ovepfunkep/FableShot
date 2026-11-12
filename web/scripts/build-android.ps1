param(
    [string] $JdkHome = $env:JAVA_HOME,
    [switch] $Offline,
    [switch] $Release,
    [string] $Keystore
)

$ErrorActionPreference = 'Stop'
$webRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $webRoot
$toolchain = Get-Content -Raw -LiteralPath (Join-Path $repoRoot '.tools/android-toolchain.json') | ConvertFrom-Json
$toolchainRoot = [IO.Path]::GetFullPath($toolchain.ToolchainRoot)
$mirrorName = if ($Release) { 'release-apk-web' } else { 'pilot-apk-web' }
$mirror = [IO.Path]::GetFullPath((Join-Path $toolchainRoot $mirrorName))
if (!$mirror.StartsWith($toolchainRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
    $mirror -match '[^\x00-\x7F]' -or $mirror -eq $webRoot) {
    throw 'The pilot build needs a dedicated ASCII directory in the Android toolchain.'
}
if ((Test-Path -LiteralPath $mirror) -and (Get-Item -LiteralPath $mirror).LinkType) {
    throw 'The pilot build directory must not be a link.'
}

$localJdkDirectory = Join-Path $toolchainRoot 'pilot-apk-jdk21'
$localJdk = Get-ChildItem -LiteralPath $localJdkDirectory -Directory -Filter 'jdk-21*' -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1
if (!$PSBoundParameters.ContainsKey('JdkHome') -and $localJdk) { $JdkHome = $localJdk.FullName }
if (!$JdkHome -or !(Test-Path -LiteralPath (Join-Path $JdkHome 'bin/java.exe'))) {
    throw 'Capacitor 8 requires JDK 21. Set JAVA_HOME or pass -JdkHome.'
}
$javaVersion = & (Join-Path $JdkHome 'bin/java.exe') -version 2>&1
if (!($javaVersion -match 'version "21(?:\.|\")')) { throw 'This build requires JDK 21.' }

$dist = Join-Path $webRoot 'dist'
$cliRelative = 'node_modules/@capacitor/cli/bin/capacitor'
if (!(Test-Path -LiteralPath (Join-Path $dist 'index.html')) -or
    !(Test-Path -LiteralPath (Join-Path $webRoot $cliRelative))) {
    throw 'From web/, install dependencies with npm ci, then run npm run build.'
}
$package = Get-Content -Raw -LiteralPath (Join-Path $webRoot 'package.json') | ConvertFrom-Json
if ($package.version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw 'Invalid web version.' }
$versionCode = $package.config.androidVersionCode
if ($versionCode -notmatch '^[1-9]\d{0,8}$') { throw 'Invalid Android build number.' }
$capConfig = Get-Content -Raw -LiteralPath (Join-Path $webRoot 'capacitor.config.json') | ConvertFrom-Json
if ($capConfig.appId -ne 'app.fableshot.android.webpilot' -or $capConfig.webDir -ne 'dist' -or $capConfig.server.url) {
    throw 'The pilot must use the isolated package ID and bundle the local web build.'
}
$utf8 = [Text.UTF8Encoding]::new($false)
if ($Release) {
    if (!$Keystore -or !(Test-Path -LiteralPath $Keystore -PathType Leaf) -or !$env:FABLESHOT_ANDROID_SIGNING_PASSWORD) {
        throw 'Release signing requires -Keystore and FABLESHOT_ANDROID_SIGNING_PASSWORD.'
    }
    $Keystore = (Resolve-Path -LiteralPath $Keystore).Path
    $capConfig.appId = 'app.fableshot.android.react'
    $capConfig.appName = 'FableShot'
}

New-Item -ItemType Directory -Path $mirror -Force | Out-Null
foreach ($dir in @('node_modules', 'dist')) {
    $destination = Join-Path $mirror $dir
    if ((Test-Path -LiteralPath $destination) -and (Get-Item -LiteralPath $destination).LinkType) {
        throw "Pilot mirror directory must not be a link: $dir"
    }
    $source = Join-Path $webRoot $dir
    $copyOptions = @('/MIR', '/XJ', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
    if ($dir -eq 'node_modules') {
        $nativeCache = '@capacitor\android\capacitor\build'
        $copyOptions += @('/XD', (Join-Path $source $nativeCache), (Join-Path $destination $nativeCache))
    }
    & robocopy.exe $source $destination @copyOptions
    if ($LASTEXITCODE -gt 7) { throw "Could not copy $dir into the pilot build." }
}
Copy-Item -LiteralPath (Join-Path $webRoot 'package.json') -Destination (Join-Path $mirror 'package.json') -Force
[IO.File]::WriteAllText((Join-Path $mirror 'capacitor.config.json'), ($capConfig | ConvertTo-Json -Depth 10), $utf8)

$env:JAVA_HOME = $JdkHome
$env:ANDROID_HOME = $toolchain.SdkRoot
$env:GRADLE_USER_HOME = $toolchain.GradleUserHome
$env:ANDROID_USER_HOME = Join-Path $toolchainRoot 'android-user'
$shell = Join-Path $mirror 'android'
if ((Test-Path -LiteralPath $shell) -and (Get-Item -LiteralPath $shell).LinkType) {
    throw 'The generated Android project must not be a link.'
}
Push-Location -LiteralPath $mirror
try {
    if (!(Test-Path -LiteralPath (Join-Path $shell 'settings.gradle'))) {
        & node $cliRelative add android
        if ($LASTEXITCODE) { throw 'Could not generate the pilot Android shell.' }
    } else {
        & node $cliRelative sync android
        if ($LASTEXITCODE) { throw 'Could not bundle the web build in the pilot Android shell.' }
    }
} finally { Pop-Location }

# Maintained plugin sources belong only to the isolated Capacitor shell.
$nativeSource = Join-Path $webRoot 'native/android'
$nativeDestination = Join-Path $shell ('app/src/main/java/' + $capConfig.appId.Replace('.', '/'))
New-Item -ItemType Directory -Path $nativeDestination -Force | Out-Null
foreach ($file in @('MainActivity.java', 'DocumentExportPlugin.java', 'PracticeTimerSoundPlugin.java')) {
    $source = Join-Path $nativeSource $file
    if (!(Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing pilot native source: $file" }
    $java = [IO.File]::ReadAllText($source).Replace('package app.fableshot.android.webpilot;', "package $($capConfig.appId);")
    [IO.File]::WriteAllText((Join-Path $nativeDestination $file), $java, $utf8)
}

[IO.File]::WriteAllText((Join-Path $shell 'local.properties'), ('sdk.dir=' + $toolchain.SdkRoot.Replace('\', '/') + "`n"), $utf8)

# Use the verified binary distribution of the exact version in the Capacitor template.
$wrapperPath = Join-Path $shell 'gradle/wrapper/gradle-wrapper.properties'
$wrapper = [IO.File]::ReadAllText($wrapperPath)
if ($wrapper -notmatch 'gradle-8\.14\.3-(?:all|bin)\.zip') { throw 'Unexpected Capacitor Gradle wrapper version.' }
$wrapper = $wrapper -replace 'gradle-8\.14\.3-all\.zip', 'gradle-8.14.3-bin.zip'
if ($wrapper -notmatch '(?m)^distributionSha256Sum=') {
    $wrapper = $wrapper.TrimEnd() + "`ndistributionSha256Sum=bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531`n"
}
[IO.File]::WriteAllText($wrapperPath, $wrapper, $utf8)

$appGradlePath = Join-Path $shell 'app/build.gradle'
$appGradle = [IO.File]::ReadAllText($appGradlePath)
$appGradle = $appGradle -replace '(?m)^[ \t]*versionName "[^"]+"', ('        versionName "' + $package.version + '"')
$appGradle = $appGradle -replace '(?m)^[ \t]*versionCode \d+', ('        versionCode ' + $versionCode)
[IO.File]::WriteAllText($appGradlePath, $appGradle, $utf8)

$iconDirectory = Join-Path $shell 'app/src/main/res/drawable-nodpi'
New-Item -ItemType Directory -Path $iconDirectory -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot 'android/app/src/main/res/drawable-nodpi/fableshot_icon.png') -Destination $iconDirectory -Force
$manifestPath = Join-Path $shell 'app/src/main/AndroidManifest.xml'
$manifest = [IO.File]::ReadAllText($manifestPath)
$manifest = $manifest.Replace('@mipmap/ic_launcher_round', '@drawable/fableshot_icon').Replace('@mipmap/ic_launcher', '@drawable/fableshot_icon').Replace('android:allowBackup="true"', 'android:allowBackup="false"')
if ($manifest -notmatch 'android.permission.WAKE_LOCK') {
    $manifest = $manifest.Replace('</manifest>', "    <uses-permission android:name=`"android.permission.WAKE_LOCK`" />`n</manifest>")
}
[IO.File]::WriteAllText($manifestPath, $manifest, $utf8)

Push-Location -LiteralPath $shell
try {
    $task = if ($Release) { ':app:assembleRelease' } else { ':app:assembleDebug' }
    $gradleTasks = @($task, '--console=plain', '--max-workers=2')
    if ($Offline) { $gradleTasks += '--offline' }
    & ./gradlew.bat @gradleTasks
    if ($LASTEXITCODE) { throw 'Pilot Android build failed.' }
} finally { Pop-Location }

$variant = if ($Release) { 'release' } else { 'debug' }
$expectedApk = if ($Release) { 'app-release-unsigned.apk' } else { 'app-debug.apk' }
$apkDir = Join-Path $shell "app/build/outputs/apk/$variant"
$metadata = Get-Content -Raw -LiteralPath (Join-Path $apkDir 'output-metadata.json') | ConvertFrom-Json
$element = $metadata.elements[0]
if ($metadata.applicationId -ne $capConfig.appId -or $element.versionName -ne $package.version -or $element.versionCode -ne $versionCode -or
    $metadata.elements.Count -ne 1 -or $element.outputFile -ne $expectedApk) {
    throw 'Unexpected APK metadata.'
}
$apk = Join-Path $apkDir $element.outputFile
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($apk)
try {
    foreach ($file in Get-ChildItem -LiteralPath $dist -Recurse -File) {
        $relative = $file.FullName.Substring($dist.Length + 1).Replace('\', '/')
        $entry = $archive.GetEntry("assets/public/$relative")
        if (!$entry) { throw "APK is missing web build asset: $relative" }
        $stream = $entry.Open()
        try { $actual = (Get-FileHash -InputStream $stream -Algorithm SHA256).Hash }
        finally { $stream.Dispose() }
        if ($actual -ne (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash) {
            throw "APK web build asset differs from dist: $relative"
        }
    }
} finally { $archive.Dispose() }

$artifacts = Join-Path $repoRoot 'artifacts'
New-Item -ItemType Directory -Path $artifacts -Force | Out-Null
$outputName = if ($Release) { 'FableShot.apk' } else { 'FableShot-Web-pilot.apk' }
$output = Join-Path $artifacts $outputName
if ($Release) {
    $buildTools = Join-Path $toolchain.SdkRoot 'build-tools/36.0.0'
    $aligned = Join-Path $apkDir 'app-release-aligned.apk'
    $signed = Join-Path $apkDir 'app-release-signed.apk'
    & (Join-Path $buildTools 'zipalign.exe') -P 16 -f 4 $apk $aligned
    if ($LASTEXITCODE) { throw 'Release alignment failed.' }
    & (Join-Path $buildTools 'apksigner.bat') sign --ks $Keystore --ks-key-alias fableshot --ks-pass env:FABLESHOT_ANDROID_SIGNING_PASSWORD --out $signed $aligned
    if ($LASTEXITCODE) { throw 'Release signing failed.' }
    & (Join-Path $buildTools 'apksigner.bat') verify --print-certs $signed
    if ($LASTEXITCODE) { throw 'Release signature verification failed.' }
    $apk = $signed
}
Copy-Item -LiteralPath $apk -Destination $output -Force
Write-Output "Verified $($metadata.applicationId) $($element.versionName): $output"
