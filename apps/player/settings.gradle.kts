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

rootProject.name = "EduCmsPlayer"
include(":app")
// Manager APK — separate process companion that holds DEVICE_OWNER
// privileges, watches the Player for crashes, and silently installs
// OTA updates. See scratch/manager-apk/01-architecture-decision.md
// for the full rationale. Phase 1 scaffold; not deployed yet.
include(":manager")
