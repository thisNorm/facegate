plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "com.example.facegate"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.example.facegate"
        minSdk = 30
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
        // 단말(arm64)과 에뮬레이터(x86_64)만. 얼굴 인식 라이브러리가 기기 종류마다 20~30MB
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildFeatures { viewBinding = false }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    sourceSets { getByName("test") { resources.srcDir("../../../contracts/examples") } }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(libs.onnxruntime.android)
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    implementation(project(":streaming"))
    implementation(libs.androidx.appcompat)
    implementation(libs.okhttp)
    implementation(libs.zxing.core)
    testImplementation(libs.junit)
    testImplementation(libs.org.json)
}
