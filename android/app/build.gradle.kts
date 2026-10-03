plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Номер версии = номер сборки + VERSION_OFFSET (чтобы номера продолжались после переезда репозитория).
// VERSION_CODE_OVERRIDE — только для тестовой «старой» сборки: на эмуляторе она должна сама обновиться до релиза.
val build = System.getenv("VERSION_CODE_OVERRIDE")?.toInt()
    ?: ((System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt() + (System.getenv("VERSION_OFFSET") ?: "0").toInt())

android {
    namespace = "ru.stikmer.raspisanie"
    compileSdk = 35

    defaultConfig {
        applicationId = "ru.stikmer.raspisanie"
        minSdk = 26
        targetSdk = 34
        versionCode = build
        versionName = "1.0.$build"
        // автообновление: из релизов какого репозитория брать новые версии
        buildConfigField("String", "UPDATE_REPO", "\"${System.getenv("GITHUB_REPOSITORY") ?: ""}\"")
    }

    buildFeatures {
        buildConfig = true
    }

    // Постоянный ключ подписи: без него каждое обновление пришлось бы ставить с удалением старой версии.
    // Сам файл ключа в репозитории не хранится: сборка достаёт его из секрета KEYSTORE_B64.
    signingConfigs {
        create("release") {
            storeFile = rootProject.file("keystore.p12")
            storePassword = "raspisanie"
            keyAlias = "raspisanie"
            keyPassword = "raspisanie"
            storeType = "pkcs12"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
