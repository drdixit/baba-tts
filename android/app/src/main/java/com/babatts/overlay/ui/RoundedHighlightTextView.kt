package com.babatts.overlay.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.text.Layout
import android.util.AttributeSet
import androidx.appcompat.widget.AppCompatTextView
import kotlin.math.max
import kotlin.math.min

/**
 * TextView that draws a smooth rounded-pill highlight behind an active character range
 * without altering glyph metrics, line wrapping, or text opacity.
 */
class RoundedHighlightTextView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = android.R.attr.textViewStyle
) : AppCompatTextView(context, attrs, defStyleAttr) {

    private var highlightStart: Int = -1
    private var highlightEnd: Int = -1
    private val highlightPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
    }
    private val highlightRect = RectF()
    private val padX = (3f * resources.displayMetrics.density)
    private val insetY = (1f * resources.displayMetrics.density)
    private val cornerRadius = (5f * resources.displayMetrics.density)

    fun setHighlightRange(startChar: Int, endChar: Int, color: Int) {
        if (highlightStart == startChar && highlightEnd == endChar && highlightPaint.color == color) {
            return
        }
        highlightStart = startChar
        highlightEnd = endChar
        highlightPaint.color = color
        invalidate()
    }

    fun clearHighlight() {
        if (highlightStart < 0 && highlightEnd < 0) return
        highlightStart = -1
        highlightEnd = -1
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        val textLayout = layout
        val len = text?.length ?: 0
        if (textLayout != null && highlightStart >= 0 && highlightEnd > highlightStart && len > 0) {
            val safeStart = highlightStart.coerceIn(0, len)
            val safeEnd = highlightEnd.coerceIn(safeStart, len)
            if (safeEnd > safeStart) {
                val firstLine = textLayout.getLineForOffset(safeStart)
                val lastLine = textLayout.getLineForOffset((safeEnd - 1).coerceAtLeast(safeStart))
                val originX = totalPaddingLeft - scrollX
                val originY = totalPaddingTop - scrollY

                for (line in firstLine..lastLine) {
                    val lineStartOffset = textLayout.getLineStart(line)
                    val ellipsisCount = textLayout.getEllipsisCount(line)
                    val lineEndOffset = if (ellipsisCount > 0) {
                        lineStartOffset + textLayout.getEllipsisStart(line)
                    } else {
                        textLayout.getLineVisibleEnd(line)
                    }
                    val segStart = max(safeStart, lineStartOffset)
                    val segEnd = min(safeEnd, lineEndOffset)
                    if (segEnd <= segStart) continue

                    val x1 = textLayout.getPrimaryHorizontal(segStart)
                    val x2 = if (segEnd == lineEndOffset && ellipsisCount == 0) {
                        if (textLayout.getParagraphDirection(line) == Layout.DIR_LEFT_TO_RIGHT) {
                            textLayout.getLineRight(line)
                        } else {
                            textLayout.getLineLeft(line)
                        }
                    } else {
                        textLayout.getPrimaryHorizontal(segEnd)
                    }
                    val left = originX + min(x1, x2) - padX
                    val right = originX + max(x1, x2) + padX
                    val top = originY + textLayout.getLineTop(line) + insetY
                    val bottom = originY + textLayout.getLineBottom(line) - insetY
                    if (right > left && bottom > top) {
                        highlightRect.set(left, top, right, bottom)
                        canvas.drawRoundRect(highlightRect, cornerRadius, cornerRadius, highlightPaint)
                    }
                }
            }
        }
        super.onDraw(canvas)
    }
}
