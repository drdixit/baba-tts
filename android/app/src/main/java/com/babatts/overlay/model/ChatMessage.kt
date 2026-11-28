package com.babatts.overlay.model

import java.util.UUID

/**
 * Data model representing a live chat or speech message.
 */
data class ChatMessage(
    val id: String = UUID.randomUUID().toString(),
    val author: String,
    val platform: String = "YouTube",
    val text: String,
    val timestamp: Long = System.currentTimeMillis(),
    val authorId: String? = null
)
