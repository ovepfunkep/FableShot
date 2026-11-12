plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose.compiler)
    alias(libs.plugins.ksp)
}

android {
    namespace = "app.fableshot.android"
    compileSdk = 36
    defaultConfig {
        applicationId = "app.fableshot.android"
        minSdk = 29
        targetSdk = 36
        versionCode = 60
        versionName = "0.30.2"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildTypes {
        debug {
            applicationIdSuffix = ".dev"
        }
        create("verification") {
            initWith(getByName("debug"))
            applicationIdSuffix = ".verification"
        }
        release {
            isMinifyEnabled = false
        }
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    sourceSets.getByName("test").resources.srcDir(providers.gradleProperty("fableshotFixtures").orNull ?: "../../docs/fixtures")
    sourceSets.getByName("androidTest").assets.srcDir(providers.gradleProperty("fableshotFixtures").orNull ?: "../../docs/fixtures")
    sourceSets.getByName("androidTest").assets.srcDir("schemas")
    sourceSets.getByName("debug").kotlin.srcDir("src/verification/java")
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

ksp { arg("room.schemaLocation", "$projectDir/schemas") }

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.tooling.preview)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    implementation(libs.coroutines.android)
    implementation(libs.datastore.preferences)
    ksp(libs.room.compiler)
    debugImplementation(libs.compose.tooling)
    debugImplementation(libs.compose.test.manifest)
    testImplementation(libs.junit)
    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.test)
    androidTestImplementation(libs.android.test.runner)
    androidTestImplementation(libs.android.test.junit)
}
