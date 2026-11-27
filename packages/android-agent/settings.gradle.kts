// Prism Android agent: an instrumentation APK that serves the Prism host<->agent
// protocol (docs/design/protocol.md) on 127.0.0.1:7100 of the device.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "prism-android-agent"
include(":agent")
