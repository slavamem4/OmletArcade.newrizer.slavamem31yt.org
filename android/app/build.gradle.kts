import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// Client-side configuration lives in config.properties, which is NOT the place
// for server secrets. LiveKit keys never reach this module.
val clientConfig = Properties().apply {
    val file = rootProject.file("config.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
fun cfg(key: String, fallback: String): String = clientConfig.getProperty(key) ?: fallback

android {
    namespace = "com.newrizer.arcade"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.newrizer.arcade"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        vectorDrawables.useSupportLibrary = true

        // Ship only the ABIs real phones use; mips and x86 would add ~25 MB of
        // native WebRTC code that no handset loads.
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a")
        }

        buildConfigField("String", "API_BASE_URL", "\"${cfg("apiBaseUrl", "https://omletarcade-newrizer-slavamem31yt-org-1.onrender.com")}\"")
        buildConfigField("String", "APP_CHECK_TOKEN", "\"${cfg("appCheckToken", "")}\"")
        buildConfigField("String", "FIREBASE_API_KEY", "\"${cfg("firebaseApiKey", "")}\"")
        buildConfigField("String", "FIREBASE_APP_ID", "\"${cfg("firebaseAppId", "")}\"")
        buildConfigField("String", "FIREBASE_PROJECT_ID", "\"${cfg("firebaseProjectId", "")}\"")
        buildConfigField("String", "FIREBASE_DB_URL", "\"${cfg("firebaseDbUrl", "")}\"")
        buildConfigField("String", "FIREBASE_SENDER_ID", "\"${cfg("firebaseSenderId", "")}\"")
    }

    signingConfigs {
        create("release") {
            val storePath = cfg("releaseStoreFile", "")
            if (storePath.isNotEmpty() && rootProject.file(storePath).exists()) {
                storeFile = rootProject.file(storePath)
                storePassword = cfg("releaseStorePassword", "")
                keyAlias = cfg("releaseKeyAlias", "")
                keyPassword = cfg("releaseKeyPassword", "")
            }
            // minSdk is 24, so the modern signature schemes are enough.
            enableV1Signing = false
            enableV2Signing = true
            enableV3Signing = true
            enableV4Signing = false
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            applicationIdSuffix = ".debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        isCoreLibraryDesugaringEnabled = true
    }

    kotlinOptions {
        jvmTarget = "17"
        freeCompilerArgs = freeCompilerArgs + "-opt-in=kotlin.RequiresOptIn"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += setOf(
            "META-INF/{AL2.0,LGPL2.1}",
            "META-INF/DEPENDENCIES",
            "META-INF/INDEX.LIST",
        )
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.3")

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.navigation:navigation-compose:2.8.4")

    val composeBom = platform("androidx.compose:compose-bom:2024.11.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.compose.ui:ui-tooling-preview")

    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-auth")
    implementation("com.google.firebase:firebase-database")

    implementation("io.livekit:livekit-android:2.29.0")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")
    implementation("com.google.crypto.tink:tink-android:1.15.0")
}
