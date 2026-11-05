plugins {
    alias(libs.plugins.android.library)
}

android {
    namespace = "com.example.facegate.streaming"
    compileSdk = 37

    defaultConfig {
        minSdk = 30
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    testOptions.unitTests.isReturnDefaultValues = true // 라이브러리의 android.util.Log 호출을 JVM 테스트에서 무시
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    // RTSP-Server 1.4.3 소스를 포함해 쓰므로 그 모듈 의존성을 같은 버전으로 둠 (third_party/README.md)
    api(libs.root.encoder)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.ktor.network)
    implementation(libs.ktor.network.tls)
    testImplementation(libs.junit)
}
