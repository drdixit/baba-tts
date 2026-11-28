package com.babatts.overlay.ui

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.RadialGradient
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.drawable.Drawable
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Dark-mode Apple-inspired glass drawable rendered with a deterministic per-chatter
 * composite color backdrop and multi-pass Dual Kawase blur (downsample + upsample pyramid passes).
 * Blurred theme textures are cached at a compact fixed resolution to avoid UI-thread CPU churn.
 */
class DualKawaseGlassDrawable(
    private val cornerRadiusPx: Float,
    private val glassAlpha: Int = 228,
    initialTheme: GlassTheme = DEFAULT_THEME
) : Drawable() {

    data class GlassTheme(
        val name: String,
        val baseTop: Int,
        val baseMid: Int,
        val baseBottom: Int,
        val orbPrimary: Int,
        val orbSecondary: Int,
        val orbTertiary: Int,
        val specularTop: Int,
        val specularUpper: Int,
        val specularBottom: Int,
        val strokeTop: Int,
        val strokeMid: Int,
        val strokeBottom: Int,
        val activeWordBg: Int
    )

    private var currentTheme: GlassTheme = initialTheme
    private var drawableAlpha: Int = 255
    private val strokeWidthPx: Float = (cornerRadiusPx / 12f).coerceAtLeast(1f)
    private val outerStrokeBaseAlpha: Int = 0xB8

    private val bitmapPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
        alpha = glassAlpha
    }
    private val specularPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val innerStrokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = strokeWidthPx
    }
    private val outerStrokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = strokeWidthPx
        color = 0xFF020617.toInt()
        alpha = outerStrokeBaseAlpha
    }

    private val boundsF = RectF()
    private val outerStrokeBoundsF = RectF()
    private val innerStrokeBoundsF = RectF()
    private val clipPath = Path()

    private var cachedWidth = 0
    private var cachedHeight = 0

    fun setTheme(theme: GlassTheme) {
        if (currentTheme == theme) return
        currentTheme = theme
        if (cachedWidth > 0 && cachedHeight > 0) {
            rebuildShaders(cachedHeight.toFloat())
        }
        invalidateSelf()
    }

    override fun onBoundsChange(bounds: Rect) {
        super.onBoundsChange(bounds)
        val w = bounds.width()
        val h = bounds.height()
        boundsF.set(bounds)
        outerStrokeBoundsF.set(
            bounds.left + strokeWidthPx * 0.5f,
            bounds.top + strokeWidthPx * 0.5f,
            bounds.right - strokeWidthPx * 0.5f,
            bounds.bottom - strokeWidthPx * 0.5f
        )
        innerStrokeBoundsF.set(
            bounds.left + strokeWidthPx * 1.5f,
            bounds.top + strokeWidthPx * 1.5f,
            bounds.right - strokeWidthPx * 1.5f,
            bounds.bottom - strokeWidthPx * 1.5f
        )

        clipPath.reset()
        clipPath.addRoundRect(boundsF, cornerRadiusPx, cornerRadiusPx, Path.Direction.CW)

        if (w > 0 && h > 0 && (w != cachedWidth || h != cachedHeight)) {
            cachedWidth = w
            cachedHeight = h
            rebuildShaders(h.toFloat())
        }
    }

    private fun rebuildShaders(h: Float) {
        specularPaint.shader = LinearGradient(
            0f, 0f, 0f, h,
            intArrayOf(
                currentTheme.specularTop,
                currentTheme.specularUpper,
                0x00000000,
                currentTheme.specularBottom
            ),
            floatArrayOf(0f, 0.28f, 0.58f, 1f),
            Shader.TileMode.CLAMP
        )

        innerStrokePaint.shader = LinearGradient(
            0f, 0f, 0f, h,
            intArrayOf(
                currentTheme.strokeTop,
                currentTheme.strokeMid,
                currentTheme.strokeBottom
            ),
            floatArrayOf(0f, 0.55f, 1f),
            Shader.TileMode.CLAMP
        )
    }

    override fun draw(canvas: Canvas) {
        if (boundsF.isEmpty) return
        val bmp = getOrRenderThemeBitmap(currentTheme)

        val saveCount = canvas.save()
        canvas.clipPath(clipPath)
        canvas.drawBitmap(bmp, null, boundsF, bitmapPaint)
        canvas.drawRoundRect(boundsF, cornerRadiusPx, cornerRadiusPx, specularPaint)
        canvas.restoreToCount(saveCount)

        val outerRadius = (cornerRadiusPx - strokeWidthPx * 0.5f).coerceAtLeast(0f)
        val innerRadius = (cornerRadiusPx - strokeWidthPx * 1.5f).coerceAtLeast(0f)
        canvas.drawRoundRect(innerStrokeBoundsF, innerRadius, innerRadius, innerStrokePaint)
        canvas.drawRoundRect(outerStrokeBoundsF, outerRadius, outerRadius, outerStrokePaint)
    }

    override fun setAlpha(alpha: Int) {
        val clamped = alpha.coerceIn(0, 255)
        if (drawableAlpha == clamped) return
        drawableAlpha = clamped
        bitmapPaint.alpha = ((glassAlpha * clamped) / 255f).roundToInt().coerceIn(0, 255)
        specularPaint.alpha = clamped
        innerStrokePaint.alpha = clamped
        outerStrokePaint.alpha = ((outerStrokeBaseAlpha * clamped) / 255f).roundToInt().coerceIn(0, 255)
        invalidateSelf()
    }

    override fun getAlpha(): Int = drawableAlpha

    override fun setColorFilter(colorFilter: ColorFilter?) {
        bitmapPaint.colorFilter = colorFilter
        specularPaint.colorFilter = colorFilter
        innerStrokePaint.colorFilter = colorFilter
        outerStrokePaint.colorFilter = colorFilter
        invalidateSelf()
    }

    @Deprecated("Deprecated in Java")
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT

    companion object {
        private const val CACHE_WORK_W = 144
        private const val CACHE_WORK_H = 88
        private val themeBitmapCache = HashMap<String, Bitmap>()

        private fun getOrRenderThemeBitmap(theme: GlassTheme): Bitmap {
            val existing = themeBitmapCache[theme.name]
            if (existing != null && !existing.isRecycled) {
                return existing
            }
            val rendered = renderCompositeDualKawase(CACHE_WORK_W, CACHE_WORK_H, theme)
            themeBitmapCache[theme.name] = rendered
            return rendered
        }

        fun clearCache() {
            for (bmp in themeBitmapCache.values) {
                if (!bmp.isRecycled) bmp.recycle()
            }
            themeBitmapCache.clear()
        }

        private fun renderCompositeDualKawase(
            workW: Int,
            workH: Int,
            theme: GlassTheme
        ): Bitmap {
            val srcBitmap = Bitmap.createBitmap(workW, workH, Bitmap.Config.ARGB_8888)
            val c = Canvas(srcBitmap)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)

            paint.shader = LinearGradient(
                0f, 0f, workW.toFloat(), workH.toFloat(),
                intArrayOf(theme.baseTop, theme.baseMid, theme.baseBottom),
                floatArrayOf(0f, 0.55f, 1f),
                Shader.TileMode.CLAMP
            )
            c.drawRect(0f, 0f, workW.toFloat(), workH.toFloat(), paint)

            paint.shader = RadialGradient(
                workW * 0.18f,
                workH * 0.22f,
                workW * 0.65f,
                intArrayOf(theme.orbPrimary, theme.orbSecondary and 0x55FFFFFF, 0x00000000),
                floatArrayOf(0f, 0.5f, 1f),
                Shader.TileMode.CLAMP
            )
            c.drawRect(0f, 0f, workW.toFloat(), workH.toFloat(), paint)

            paint.shader = RadialGradient(
                workW * 0.84f,
                workH * 0.25f,
                workW * 0.55f,
                intArrayOf(theme.orbSecondary, theme.orbTertiary and 0x44FFFFFF, 0x00000000),
                floatArrayOf(0f, 0.55f, 1f),
                Shader.TileMode.CLAMP
            )
            c.drawRect(0f, 0f, workW.toFloat(), workH.toFloat(), paint)

            paint.shader = RadialGradient(
                workW * 0.52f,
                workH * 0.92f,
                workW * 0.6f,
                intArrayOf(theme.orbTertiary, theme.orbPrimary and 0x33FFFFFF, 0x00000000),
                floatArrayOf(0f, 0.55f, 1f),
                Shader.TileMode.CLAMP
            )
            c.drawRect(0f, 0f, workW.toFloat(), workH.toFloat(), paint)

            val pixels = IntArray(workW * workH)
            srcBitmap.getPixels(pixels, 0, workW, 0, 0, workW, workH)
            srcBitmap.recycle()

            val blurred = dualKawaseBlur(pixels, workW, workH, passes = 3)
            return Bitmap.createBitmap(blurred, workW, workH, Bitmap.Config.ARGB_8888)
        }

        val OCEAN_BLUE = GlassTheme(
            name = "Ocean Blue",
            baseTop = 0xFF0A1936.toInt(),
            baseMid = 0xFF071229.toInt(),
            baseBottom = 0xFF050B18.toInt(),
            orbPrimary = 0xCC2563EB.toInt(),
            orbSecondary = 0xB30EA5E9.toInt(),
            orbTertiary = 0x991D4ED8.toInt(),
            specularTop = 0x36BAE6FD,
            specularUpper = 0x0C38BDF8,
            specularBottom = 0x1A1D4ED8,
            strokeTop = 0x7A93C5FD,
            strokeMid = 0x2938BDF8,
            strokeBottom = 0x3360A5FA,
            activeWordBg = 0xB81D4ED8.toInt()
        )

        val ROYAL_VIOLET = GlassTheme(
            name = "Royal Violet",
            baseTop = 0xFF1E103C.toInt(),
            baseMid = 0xFF130A29.toInt(),
            baseBottom = 0xFF0A0518.toInt(),
            orbPrimary = 0xCC7C3AED.toInt(),
            orbSecondary = 0xB3A855F7.toInt(),
            orbTertiary = 0x996D28D9.toInt(),
            specularTop = 0x36DDD6FE,
            specularUpper = 0x0CC084FC,
            specularBottom = 0x1A7C3AED,
            strokeTop = 0x7AC4B5FD,
            strokeMid = 0x29A78BFA,
            strokeBottom = 0x33C084FC,
            activeWordBg = 0xB86D28D9.toInt()
        )

        val EMERALD_TEAL = GlassTheme(
            name = "Emerald Teal",
            baseTop = 0xFF072926.toInt(),
            baseMid = 0xFF051C1B.toInt(),
            baseBottom = 0xFF031011.toInt(),
            orbPrimary = 0xBD0D9488.toInt(),
            orbSecondary = 0x9E0F766E.toInt(),
            orbTertiary = 0x9914B8A6.toInt(),
            specularTop = 0x36A7F3D0,
            specularUpper = 0x0C2DD4BF,
            specularBottom = 0x1A059669,
            strokeTop = 0x7A5EEAD4,
            strokeMid = 0x292DD4BF,
            strokeBottom = 0x3334D399,
            activeWordBg = 0xCC047857.toInt()
        )

        val ROSE_CRIMSON = GlassTheme(
            name = "Rose Crimson",
            baseTop = 0xFF330C1D.toInt(),
            baseMid = 0xFF220714.toInt(),
            baseBottom = 0xFF13040C.toInt(),
            orbPrimary = 0xCCE11D48.toInt(),
            orbSecondary = 0xB3EC4899.toInt(),
            orbTertiary = 0x99BE123C.toInt(),
            specularTop = 0x36FECDD3,
            specularUpper = 0x0CFB7185,
            specularBottom = 0x1AE11D48,
            strokeTop = 0x7AFDA4AF,
            strokeMid = 0x29FB7185,
            strokeBottom = 0x33F472B6,
            activeWordBg = 0xB8BE123C.toInt()
        )

        val INDIGO_TWILIGHT = GlassTheme(
            name = "Indigo Twilight",
            baseTop = 0xFF131942.toInt(),
            baseMid = 0xFF0C102E.toInt(),
            baseBottom = 0xFF07091C.toInt(),
            orbPrimary = 0xCC4F46E5.toInt(),
            orbSecondary = 0xB36366F1.toInt(),
            orbTertiary = 0x993B82F6.toInt(),
            specularTop = 0x36C7D2FE,
            specularUpper = 0x0C818CF8,
            specularBottom = 0x1A4F46E5,
            strokeTop = 0x7AA5B4FC,
            strokeMid = 0x29818CF8,
            strokeBottom = 0x3360A5FA,
            activeWordBg = 0xB84338CA.toInt()
        )

        val CYAN_AURORA = GlassTheme(
            name = "Cyan Aurora",
            baseTop = 0xFF072536.toInt(),
            baseMid = 0xFF051826.toInt(),
            baseBottom = 0xFF030F1A.toInt(),
            orbPrimary = 0xBF0284C7.toInt(),
            orbSecondary = 0x990369A1.toInt(),
            orbTertiary = 0x990E7490.toInt(),
            specularTop = 0x36A5F3FC,
            specularUpper = 0x0C22D3EE,
            specularBottom = 0x1A0284C7,
            strokeTop = 0x7A67E8F9,
            strokeMid = 0x2922D3EE,
            strokeBottom = 0x3338BDF8,
            activeWordBg = 0xBF0369A1.toInt()
        )

        val AMBER_DUSK = GlassTheme(
            name = "Amber Dusk",
            baseTop = 0xFF2B1606.toInt(),
            baseMid = 0xFF1D0E04.toInt(),
            baseBottom = 0xFF120802.toInt(),
            orbPrimary = 0xB8B45309.toInt(),
            orbSecondary = 0x9992400E.toInt(),
            orbTertiary = 0x99C2410C.toInt(),
            specularTop = 0x36FDE68A,
            specularUpper = 0x0CFBBF24,
            specularBottom = 0x1AD97706,
            strokeTop = 0x7AFCD34D,
            strokeMid = 0x29FBBF24,
            strokeBottom = 0x33FB923C,
            activeWordBg = 0xCC92400E.toInt()
        )

        val MAGENTA_PLUM = GlassTheme(
            name = "Magenta Plum",
            baseTop = 0xFF2D0F38.toInt(),
            baseMid = 0xFF1E0926.toInt(),
            baseBottom = 0xFF110517.toInt(),
            orbPrimary = 0xCCC026D3.toInt(),
            orbSecondary = 0xB3E879F9.toInt(),
            orbTertiary = 0x999333EA.toInt(),
            specularTop = 0x36F5D0FE,
            specularUpper = 0x0CE879F9,
            specularBottom = 0x1AC026D3,
            strokeTop = 0x7AF0ABFC,
            strokeMid = 0x29E879F9,
            strokeBottom = 0x33C084FC,
            activeWordBg = 0xB8A21CAF.toInt()
        )

        val DEFAULT_THEME: GlassTheme = OCEAN_BLUE

        val CHAT_THEMES: List<GlassTheme> = listOf(
            OCEAN_BLUE,
            ROYAL_VIOLET,
            EMERALD_TEAL,
            ROSE_CRIMSON,
            INDIGO_TWILIGHT,
            CYAN_AURORA,
            AMBER_DUSK,
            MAGENTA_PLUM
        )

        /**
         * Deterministically picks a rich dark-mode glass theme for [author],
         * matching the desktop app's DJB2-style username hash.
         */
        fun themeForAuthor(author: String?): GlassTheme {
            if (author.isNullOrBlank()) return DEFAULT_THEME
            var hash = 0
            for (ch in author) {
                hash = ch.code + ((hash shl 5) - hash)
            }
            val index = (abs(hash.toLong()) % CHAT_THEMES.size).toInt()
            return CHAT_THEMES[index]
        }

        /**
         * Executes multi-pass Dual Kawase blur (N downsample passes followed by N upsample passes)
         * on an ARGB pixel buffer.
         */
        internal fun dualKawaseBlur(
            pixels: IntArray,
            width: Int,
            height: Int,
            passes: Int = 3
        ): IntArray {
            if (width <= 2 || height <= 2 || passes <= 0) return pixels.copyOf()

            val pyramid = ArrayList<Triple<IntArray, Int, Int>>(passes + 1)
            pyramid.add(Triple(pixels.copyOf(), width, height))

            for (p in 0 until passes) {
                val (src, sw, sh) = pyramid.last()
                val dw = (sw / 2).coerceAtLeast(4)
                val dh = (sh / 2).coerceAtLeast(4)
                if (dw == sw && dh == sh) break
                val dst = downsampleKawase(src, sw, sh, dw, dh)
                pyramid.add(Triple(dst, dw, dh))
            }

            var (cur, cw, ch) = pyramid.last()
            for (i in pyramid.size - 2 downTo 0) {
                val (_, tw, th) = pyramid[i]
                cur = upsampleKawase(cur, cw, ch, tw, th)
                cw = tw
                ch = th
            }
            return cur
        }

        private fun downsampleKawase(
            src: IntArray,
            sw: Int,
            sh: Int,
            dw: Int,
            dh: Int
        ): IntArray {
            val dst = IntArray(dw * dh)
            val scaleX = sw.toFloat() / dw
            val scaleY = sh.toFloat() / dh
            for (y in 0 until dh) {
                val sy = ((y + 0.5f) * scaleY).toInt().coerceIn(0, sh - 1)
                val syUp = (sy - 1).coerceAtLeast(0)
                val syDn = (sy + 1).coerceAtMost(sh - 1)
                for (x in 0 until dw) {
                    val sx = ((x + 0.5f) * scaleX).toInt().coerceIn(0, sw - 1)
                    val sxL = (sx - 1).coerceAtLeast(0)
                    val sxR = (sx + 1).coerceAtMost(sw - 1)

                    val c = src[sy * sw + sx]
                    val tl = src[syUp * sw + sxL]
                    val tr = src[syUp * sw + sxR]
                    val bl = src[syDn * sw + sxL]
                    val br = src[syDn * sw + sxR]

                    val a = (((c ushr 24) and 0xFF) * 4 + ((tl ushr 24) and 0xFF) + ((tr ushr 24) and 0xFF) + ((bl ushr 24) and 0xFF) + ((br ushr 24) and 0xFF)) ushr 3
                    val r = (((c ushr 16) and 0xFF) * 4 + ((tl ushr 16) and 0xFF) + ((tr ushr 16) and 0xFF) + ((bl ushr 16) and 0xFF) + ((br ushr 16) and 0xFF)) ushr 3
                    val g = (((c ushr 8) and 0xFF) * 4 + ((tl ushr 8) and 0xFF) + ((tr ushr 8) and 0xFF) + ((bl ushr 8) and 0xFF) + ((br ushr 8) and 0xFF)) ushr 3
                    val b = ((c and 0xFF) * 4 + (tl and 0xFF) + (tr and 0xFF) + (bl and 0xFF) + (br and 0xFF)) ushr 3

                    dst[y * dw + x] = (a shl 24) or (r shl 16) or (g shl 8) or b
                }
            }
            return dst
        }

        private fun sampleBilinear(src: IntArray, sw: Int, sh: Int, fx: Float, fy: Float): Int {
            val x0 = fx.toInt().coerceIn(0, sw - 1)
            val y0 = fy.toInt().coerceIn(0, sh - 1)
            val x1 = (x0 + 1).coerceAtMost(sw - 1)
            val y1 = (y0 + 1).coerceAtMost(sh - 1)
            val tx = (fx - x0).coerceIn(0f, 1f)
            val ty = (fy - y0).coerceIn(0f, 1f)
            val w00 = (1f - tx) * (1f - ty)
            val w10 = tx * (1f - ty)
            val w01 = (1f - tx) * ty
            val w11 = tx * ty

            val c00 = src[y0 * sw + x0]
            val c10 = src[y0 * sw + x1]
            val c01 = src[y1 * sw + x0]
            val c11 = src[y1 * sw + x1]

            val a = (((c00 ushr 24) and 0xFF) * w00 + ((c10 ushr 24) and 0xFF) * w10 + ((c01 ushr 24) and 0xFF) * w01 + ((c11 ushr 24) and 0xFF) * w11).roundToInt().coerceIn(0, 255)
            val r = (((c00 ushr 16) and 0xFF) * w00 + ((c10 ushr 16) and 0xFF) * w10 + ((c01 ushr 16) and 0xFF) * w01 + ((c11 ushr 16) and 0xFF) * w11).roundToInt().coerceIn(0, 255)
            val g = (((c00 ushr 8) and 0xFF) * w00 + ((c10 ushr 8) and 0xFF) * w10 + ((c01 ushr 8) and 0xFF) * w01 + ((c11 ushr 8) and 0xFF) * w11).roundToInt().coerceIn(0, 255)
            val b = ((c00 and 0xFF) * w00 + (c10 and 0xFF) * w10 + (c01 and 0xFF) * w01 + (c11 and 0xFF) * w11).roundToInt().coerceIn(0, 255)
            return (a shl 24) or (r shl 16) or (g shl 8) or b
        }

        private fun upsampleKawase(
            src: IntArray,
            sw: Int,
            sh: Int,
            tw: Int,
            th: Int
        ): IntArray {
            val dst = IntArray(tw * th)
            val scaleX = sw.toFloat() / tw
            val scaleY = sh.toFloat() / th
            for (y in 0 until th) {
                val fy = ((y + 0.5f) * scaleY - 0.5f).coerceIn(0f, (sh - 1).toFloat())
                for (x in 0 until tw) {
                    val fx = ((x + 0.5f) * scaleX - 0.5f).coerceIn(0f, (sw - 1).toFloat())
                    val l = sampleBilinear(src, sw, sh, fx - 0.5f, fy)
                    val r = sampleBilinear(src, sw, sh, fx + 0.5f, fy)
                    val t = sampleBilinear(src, sw, sh, fx, fy - 0.5f)
                    val b = sampleBilinear(src, sw, sh, fx, fy + 0.5f)
                    val tl = sampleBilinear(src, sw, sh, fx - 0.5f, fy - 0.5f)
                    val tr = sampleBilinear(src, sw, sh, fx + 0.5f, fy - 0.5f)
                    val bl = sampleBilinear(src, sw, sh, fx - 0.5f, fy + 0.5f)
                    val br = sampleBilinear(src, sw, sh, fx + 0.5f, fy + 0.5f)

                    val aSum = (((l ushr 24) and 0xFF) + ((r ushr 24) and 0xFF) + ((t ushr 24) and 0xFF) + ((b ushr 24) and 0xFF)) * 2 +
                        ((tl ushr 24) and 0xFF) + ((tr ushr 24) and 0xFF) + ((bl ushr 24) and 0xFF) + ((br ushr 24) and 0xFF)
                    val rSum = (((l ushr 16) and 0xFF) + ((r ushr 16) and 0xFF) + ((t ushr 16) and 0xFF) + ((b ushr 16) and 0xFF)) * 2 +
                        ((tl ushr 16) and 0xFF) + ((tr ushr 16) and 0xFF) + ((bl ushr 16) and 0xFF) + ((br ushr 16) and 0xFF)
                    val gSum = (((l ushr 8) and 0xFF) + ((r ushr 8) and 0xFF) + ((t ushr 8) and 0xFF) + ((b ushr 8) and 0xFF)) * 2 +
                        ((tl ushr 8) and 0xFF) + ((tr ushr 8) and 0xFF) + ((bl ushr 8) and 0xFF) + ((br ushr 8) and 0xFF)
                    val bSum = ((l and 0xFF) + (r and 0xFF) + (t and 0xFF) + (b and 0xFF)) * 2 +
                        (tl and 0xFF) + (tr and 0xFF) + (bl and 0xFF) + (br and 0xFF)

                    dst[y * tw + x] = ((aSum / 12) shl 24) or ((rSum / 12) shl 16) or ((gSum / 12) shl 8) or (bSum / 12)
                }
            }
            return dst
        }
    }
}
