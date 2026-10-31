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

rootProject.name = "cuentas-claras"

// :core  -> lógica financiera pura (Kotlin/JVM), sin Android: cálculos deterministas y pruebas.
// :app   -> aplicación Android (Fase 2).
include(":core", ":app")
