package com.babatts.overlay.model

/**
 * Represents a single word boundary timestamp emitted by Azure Speech synthesis.
 */
data class WordBoundary(
    val text: String,
    val offsetMs: Long,
    val durationMs: Long,
    val textOffset: Int = 0
)
