using System.Buffers.Binary;
using System.Text;
using Ember.Core.Models;

namespace Ember.Core.Services;

/// <summary>
/// Checks the pictures of a feedback and strips their metadata without decoding pixels: an allowlist rewrite of the container.
/// JPEG keeps SOI, APP14 (Adobe), DQT, DHT, DRI, one SOFn, every SOS with its entropy-coded data (RSTn included) and EOI, and
/// drops APP0 to APP13, APP15 and COM; any other marker (DAC, DNL, a second SOI, ...) rejects it. PNG keeps IHDR (first), PLTE,
/// IDAT (at least one), tRNS, gAMA, cHRM, sRGB, sBIT, bKGD, pHYs and IEND, each with a valid CRC, and drops every other chunk.
/// WebP keeps VP8X (only the alpha flag left), ALPH and one VP8 or VP8L, and drops ICCP, EXIF, XMP and unknown chunks; ANIM or
/// ANMF (or the animation flag) rejects it. Bytes after EOI, IEND or the RIFF size are dropped.
/// </summary>
public static class FeedbackImages
{
    /// <summary>Most pictures one feedback can carry.</summary>
    public const int MaxCount = 5;

    /// <summary>Most decoded bytes all pictures of one feedback can have together, before stripping.</summary>
    public const long MaxTotalBytes = 10L * 1024 * 1024;

    /// <summary>Most pixels a picture can have per side.</summary>
    public const int MaxSide = 4096;

    /// <summary>The error for a picture that isn't valid base64 or whose structure is broken.</summary>
    public const string Unreadable = "One of the pictures couldn't be read. Try another one.";

    private const string TooBig = "That picture is too large, up to 4096 pixels per side.";
    private const string Animated = "Ember can take still pictures only, no animations.";

    private static ReadOnlySpan<byte> PngSignature => [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    private static readonly uint[] CrcTable = BuildCrcTable();

    /// <summary>
    /// The checks that need no decoding, or null when they pass: signed in, at most <see cref="MaxCount"/>, no null or empty
    /// entry, and at most <see cref="MaxTotalBytes"/> as bounded by the base64 lengths.
    /// </summary>
    public static string? RequestError(IReadOnlyList<string?> images, bool signedIn)
    {
        if (!signedIn) return "Sign in to add pictures.";
        if (images.Count > MaxCount) return $"Up to {MaxCount} pictures.";

        long bytes = 0;
        foreach (var image in images)
        {
            if (string.IsNullOrWhiteSpace(image)) return "One of the pictures is empty.";
            bytes += image.Length * 3L / 4 - (image.EndsWith("==", StringComparison.Ordinal) ? 2 : image.EndsWith('=') ? 1 : 0);
        }

        return bytes > MaxTotalBytes ? "Pictures can be up to 10 MB together." : null;
    }

    /// <summary>The bytes of one standard base64 picture, or null when it isn't valid base64 or is empty.</summary>
    public static byte[]? Decode(string base64)
    {
        var buffer = new byte[base64.Length * 3L / 4];
        return Convert.TryFromBase64String(base64, buffer, out var length) && length > 0 ? buffer[..length] : null;
    }

    /// <summary>
    /// Returns the picture stripped (see the class summary) with its sniffed content type, or null with the reason in
    /// <paramref name="error"/>. Never throws for bad input.
    /// </summary>
    public static FeedbackImage? Sanitize(ReadOnlySpan<byte> data, out string? error)
    {
        using var output = new MemoryStream(data.Length);
        string contentType;
        if (data is [0xFF, 0xD8, 0xFF, ..])
        {
            contentType = "image/jpeg";
            error = Jpeg(data, output);
        }
        else if (data.StartsWith(PngSignature))
        {
            contentType = "image/png";
            error = Png(data, output);
        }
        else if (data.Length >= 12 && data.StartsWith("RIFF"u8) && data[8..].StartsWith("WEBP"u8))
        {
            contentType = "image/webp";
            error = WebP(data, output);
        }
        else
        {
            error = "Ember can take JPEG, PNG or WebP pictures.";
            return null;
        }

        return error is null ? new FeedbackImage { ContentType = contentType, Data = output.ToArray() } : null;
    }

    private static string? Side(long width, long height)
        => width <= 0 || height <= 0 ? Unreadable : width > MaxSide || height > MaxSide ? TooBig : null;

    private static string? Jpeg(ReadOnlySpan<byte> data, MemoryStream output)
    {
        output.Write([0xFF, 0xD8]);
        var position = 2;
        var frame = false;
        var scanned = false;
        while (true)
        {
            if (position >= data.Length || data[position] != 0xFF) return Unreadable;
            while (position < data.Length && data[position] == 0xFF) position++;
            if (position >= data.Length) return Unreadable;
            var marker = data[position++];
            if (marker == 0xD9)
            {
                if (!scanned) return Unreadable;
                output.Write([0xFF, 0xD9]);
                return null;
            }

            if (data.Length - position < 2) return Unreadable;
            int length = BinaryPrimitives.ReadUInt16BigEndian(data[position..]);
            if (length < 2 || length > data.Length - position) return Unreadable;
            var segment = data.Slice(position - 2, length + 2);
            var payload = data.Slice(position + 2, length - 2);
            position += length;
            switch (marker)
            {
                case 0xEE or 0xDB or 0xC4 or 0xDD:
                    output.Write(segment);
                    break;
                case (>= 0xE0 and <= 0xEF) or 0xFE:
                    break;
                case (>= 0xC0 and <= 0xC3) or (>= 0xC5 and <= 0xC7) or (>= 0xC9 and <= 0xCB) or (>= 0xCD and <= 0xCF):
                    if (frame || payload.Length < 6) return Unreadable;
                    if (Side(BinaryPrimitives.ReadUInt16BigEndian(payload[3..]), BinaryPrimitives.ReadUInt16BigEndian(payload[1..])) is { } sideError)
                        return sideError;
                    frame = true;
                    output.Write(segment);
                    break;
                case 0xDA:
                    if (!frame) return Unreadable;
                    output.Write(segment);
                    var start = position;
                    while (true)
                    {
                        var next = data[position..].IndexOf((byte)0xFF);
                        if (next < 0 || position + next + 1 >= data.Length) return Unreadable;
                        position += next;
                        if (data[position + 1] is not (0x00 or (>= 0xD0 and <= 0xD7))) break;
                        position += 2;
                    }
                    output.Write(data[start..position]);
                    scanned = true;
                    break;
                default:
                    return Unreadable;
            }
        }
    }

    private static string? Png(ReadOnlySpan<byte> data, MemoryStream output)
    {
        output.Write(PngSignature);
        var position = PngSignature.Length;
        var first = true;
        var idat = false;
        while (true)
        {
            if (data.Length - position < 12) return Unreadable;
            var length = BinaryPrimitives.ReadUInt32BigEndian(data[position..]);
            if (length > data.Length - position - 12L) return Unreadable;
            var chunk = data.Slice(position, 12 + (int)length);
            position += chunk.Length;
            var type = Encoding.ASCII.GetString(chunk.Slice(4, 4));
            if (first != (type == "IHDR")) return Unreadable;
            if (type is not ("IHDR" or "PLTE" or "IDAT" or "IEND" or "tRNS" or "gAMA" or "cHRM" or "sRGB" or "sBIT" or "bKGD" or "pHYs")) continue;
            if (BinaryPrimitives.ReadUInt32BigEndian(chunk[^4..]) != Crc32(chunk[4..^4])) return Unreadable;
            if (first)
            {
                if (length != 13) return Unreadable;
                if (Side(BinaryPrimitives.ReadUInt32BigEndian(chunk[8..]), BinaryPrimitives.ReadUInt32BigEndian(chunk[12..])) is { } sideError)
                    return sideError;
                first = false;
            }

            idat |= type == "IDAT";
            output.Write(chunk);
            if (type == "IEND") return idat ? null : Unreadable;
        }
    }

    private static string? WebP(ReadOnlySpan<byte> data, MemoryStream output)
    {
        var riffSize = BinaryPrimitives.ReadUInt32LittleEndian(data[4..]);
        if (riffSize < 4 || riffSize > data.Length - 8L) return Unreadable;
        var end = 8 + (int)riffSize;
        output.Write("RIFF\0\0\0\0WEBP"u8);

        var position = 12;
        var extended = false;
        long canvasWidth = 0, canvasHeight = 0;
        var image = false;
        while (position < end)
        {
            if (end - position < 8) return Unreadable;
            var fourCc = Encoding.ASCII.GetString(data.Slice(position, 4));
            var size = BinaryPrimitives.ReadUInt32LittleEndian(data[(position + 4)..]);
            if (size + (size & 1) > end - position - 8L) return Unreadable;
            var payload = data.Slice(position + 8, (int)size);
            var chunkStart = position;
            position += 8 + (int)(size + (size & 1));
            if (chunkStart == 12 && fourCc is not ("VP8 " or "VP8L" or "VP8X")) return Unreadable;

            switch (fourCc)
            {
                case "VP8X":
                    if (chunkStart != 12 || size < 10) return Unreadable;
                    if ((payload[0] & 0x02) != 0) return Animated;
                    canvasWidth = 1 + (payload[4] | payload[5] << 8 | payload[6] << 16);
                    canvasHeight = 1 + (payload[7] | payload[8] << 8 | payload[9] << 16);
                    if (Side(canvasWidth, canvasHeight) is { } canvasError) return canvasError;
                    extended = true;
                    output.Write("VP8X"u8);
                    output.Write([10, 0, 0, 0, (byte)(payload[0] & 0x10), 0, 0, 0]);
                    output.Write(payload[4..10]);
                    break;
                case "ANIM" or "ANMF":
                    return Animated;
                case "ALPH" when extended && !image:
                    WriteChunk(output, data.Slice(chunkStart, 8 + (int)size));
                    break;
                case "VP8 " or "VP8L":
                    if (image) return Unreadable;
                    long width, height;
                    if (fourCc == "VP8 ")
                    {
                        if (size < 10 || (payload[0] & 1) != 0 || !payload[3..6].SequenceEqual((ReadOnlySpan<byte>)[0x9D, 0x01, 0x2A])) return Unreadable;
                        width = BinaryPrimitives.ReadUInt16LittleEndian(payload[6..]) & 0x3FFF;
                        height = BinaryPrimitives.ReadUInt16LittleEndian(payload[8..]) & 0x3FFF;
                    }
                    else
                    {
                        if (size < 5 || payload[0] != 0x2F) return Unreadable;
                        var bits = BinaryPrimitives.ReadUInt32LittleEndian(payload[1..]);
                        if (bits >> 29 != 0) return Unreadable;
                        width = (bits & 0x3FFF) + 1;
                        height = (bits >> 14 & 0x3FFF) + 1;
                    }

                    if (extended && (width != canvasWidth || height != canvasHeight)) return Unreadable;
                    if (Side(width, height) is { } sideError) return sideError;
                    WriteChunk(output, data.Slice(chunkStart, 8 + (int)size));
                    image = true;
                    break;
            }

            if (image && !extended) break;
        }

        if (!image) return Unreadable;
        Span<byte> riff = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32LittleEndian(riff, (uint)(output.Length - 8));
        output.Position = 4;
        output.Write(riff);
        return null;
    }

    private static void WriteChunk(MemoryStream output, ReadOnlySpan<byte> chunk)
    {
        output.Write(chunk);
        if ((chunk.Length & 1) != 0) output.WriteByte(0);
    }

    private static uint Crc32(ReadOnlySpan<byte> bytes)
    {
        var crc = 0xFFFFFFFFu;
        foreach (var b in bytes) crc = CrcTable[(crc ^ b) & 0xFF] ^ (crc >> 8);
        return crc ^ 0xFFFFFFFFu;
    }

    private static uint[] BuildCrcTable()
    {
        var table = new uint[256];
        for (uint n = 0; n < 256; n++)
        {
            var c = n;
            for (var k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320 ^ (c >> 1) : c >> 1;
            table[n] = c;
        }

        return table;
    }
}
