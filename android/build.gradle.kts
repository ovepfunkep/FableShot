plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.compose.compiler) apply false
    alias(libs.plugins.ksp) apply false
}

tasks.wrapper {
    gradleVersion = "9.3.1"
    distributionType = org.gradle.api.tasks.wrapper.Wrapper.DistributionType.BIN
    distributionSha256Sum = "b266d5ff6b90eada6dc3b20cb090e3731302e553a27c5d3e4df1f0d76beaff06"
}
