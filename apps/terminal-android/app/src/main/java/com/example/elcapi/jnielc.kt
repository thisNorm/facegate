package com.example.elcapi

/**
 * 단말 제조사 불빛 라이브러리(libjnielc.so, 단말의 pwmlightdemo 앱에서 가져옴)의 JNI 입구.
 * 라이브러리 안 함수 이름이 이 패키지와 클래스 이름에 묶여 있어 이름을 바꾸면 안 된다.
 */
@Suppress("ClassName")
object jnielc {
    init {
        System.loadLibrary("jnielc")
    }

    @JvmStatic external fun seekstart(): Int
    @JvmStatic external fun ledseek(channel: Int, value: Int): Int
    @JvmStatic external fun seekstop(): Int
}
