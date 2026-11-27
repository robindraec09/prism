plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "io.prismtest.agent"
    compileSdk = 35

    defaultConfig {
        // Package IDs and runner are fixed by docs/design/protocol.md section 4.3 and Q3.
        applicationId = "io.prismtest.agent"
        testApplicationId = "io.prismtest.agent.test"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        minSdk = 29 // AND-3: Android 10 and later
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    testOptions {
        // JVM unit tests must not touch android.* stubs; the protocol layer is pure Kotlin.
        unitTests.isReturnDefaultValues = false
    }
}

dependencies {
    // The agent APK itself has no third-party runtime dependencies (Kotlin stdlib only).
    // Instrumentation APK (Apache 2.0). androidx.test pulls in junit:junit (EPL 1.0): see
    // docs/design/android-agent.md, "Licences".
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")

    // JVM unit tests only, never shipped.
    testImplementation("junit:junit:4.13.2")
}
