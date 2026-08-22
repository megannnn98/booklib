package io.github.megannnn98.booklib

import org.junit.Assert.*
import org.junit.Test

class ContentDispositionParserTest {

    @Test
    fun `parse filename from simple Content-Disposition`() {
        val result = ContentDispositionParser.parseFilename(
            "attachment; filename=\"document.pdf\"",
            "https://example.com/file"
        )
        assertEquals("document.pdf", result)
    }

    @Test
    fun `parse filename without quotes`() {
        val result = ContentDispositionParser.parseFilename(
            "attachment; filename=document.pdf",
            "https://example.com/file"
        )
        assertEquals("document.pdf", result)
    }

    @Test
    fun `filename with plus sign - preserve as plus`() {
        val result = ContentDispositionParser.parseFilename(
            "attachment; filename*=UTF-8''C%2B%2B%20Primer.pdf",
            "https://example.com/file"
        )
        assertEquals("C++ Primer.pdf", result)
    }

    @Test
    fun `parse filename* with cyrillic`() {
        val result = ContentDispositionParser.parseFilename(
            "attachment; filename*=UTF-8''%D0%9C%D0%BE%D1%8F%20%D0%BA%D0%BD%D0%B8%D0%B3%D0%B0.pdf",
            "https://example.com/file"
        )
        assertEquals("Моя книга.pdf", result)
    }

    @Test
    fun `filename* takes precedence over filename`() {
        val result = ContentDispositionParser.parseFilename(
            "attachment; filename=\"fallback.pdf\"; filename*=UTF-8''%D0%9A%D0%BD%D0%B8%D0%B3%D0%B0.pdf",
            "https://example.com/file"
        )
        assertEquals("Книга.pdf", result)
    }

    @Test
    fun `fallback to URL when Content-Disposition is null`() {
        val result = ContentDispositionParser.parseFilename(
            null,
            "https://example.com/path/to/document.pdf"
        )
        assertEquals("document.pdf", result)
    }

    @Test
    fun `fallback to URL when Content-Disposition has no filename`() {
        val result = ContentDispositionParser.parseFilename(
            "attachment",
            "https://example.com/path/to/document.pdf"
        )
        assertEquals("document.pdf", result)
    }

    @Test
    fun `fallback to extension from mime type when URL has no filename`() {
        val result = ContentDispositionParser.parseFilename(
            null,
            "https://example.com/",
            "application/pdf"
        )
        assertEquals("booklib_file.pdf", result)
    }

    @Test
    fun `fallback to epub extension`() {
        val result = ContentDispositionParser.parseFilename(
            null,
            "https://example.com/",
            "application/epub+zip"
        )
        assertEquals("booklib_file.epub", result)
    }

    @Test
    fun `fallback to fb2 extension`() {
        val result = ContentDispositionParser.parseFilename(
            null,
            "https://example.com/",
            "application/x-fictionbook+xml"
        )
        assertEquals("booklib_file.fb2", result)
    }

    @Test
    fun `fallback to djvu extension`() {
        val result = ContentDispositionParser.parseFilename(
            null,
            "https://example.com/",
            "image/vnd.djvu"
        )
        assertEquals("booklib_file.djvu", result)
    }

    @Test
    fun `fallback to generic extension for unknown mime`() {
        val result = ContentDispositionParser.parseFilename(
            null,
            "https://example.com/",
            "application/octet-stream"
        )
        assertEquals("booklib_file.download", result)
    }

    @Test
    fun `filename with spaces and cyrillic`() {
        val result = ContentDispositionParser.parseFilename(
            "attachment; filename=\"Моя книга (2024).pdf\"",
            "https://example.com/file"
        )
        assertEquals("Моя книга (2024).pdf", result)
    }

    @Test
    fun `filename with special characters`() {
        val result = ContentDispositionParser.parseFilename(
            "attachment; filename=\"Книга - Том 1 [издание].epub\"",
            "https://example.com/file"
        )
        assertEquals("Книга - Том 1 [издание].epub", result)
    }

    @Test
    fun `empty Content-Disposition falls back to URL`() {
        val result = ContentDispositionParser.parseFilename(
            "",
            "https://example.com/document.pdf"
        )
        assertEquals("document.pdf", result)
    }

    @Test
    fun `URL with query parameters - extract filename from path`() {
        val result = ContentDispositionParser.parseFilename(
            null,
            "https://example.com/download?file=document.pdf&id=123"
        )
        assertEquals("document.pdf", result)
    }

    @Test
    fun `URL without extension - use mime type`() {
        val result = ContentDispositionParser.parseFilename(
            null,
            "https://example.com/download/123",
            "application/pdf"
        )
        assertEquals("booklib_file.pdf", result)
    }
}
