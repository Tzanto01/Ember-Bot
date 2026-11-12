using System.Buffers.Binary;
using System.Text;

namespace Ember.Api.Tests;

/// <summary>Minimal structurally valid pictures built in code, with room to add metadata and defects.</summary>
internal static class SyntheticImages
{
    public static readonly byte[] ExifMarker = Encoding.ASCII.GetBytes("GPS-SECRET-LOCATION");

    public static byte[] Join(params byte[][] parts) => parts.SelectMany(p => p).ToArray();

    private static byte[] Be16(int value) => [(byte)(value >> 8), (byte)value];

    private static byte[] JpegSegment(byte marker, byte[] payload) => Join([0xFF, marker], Be16(payload.Length + 2), payload);

    public static byte[] Jpeg(int width = 8, int height = 8, bool metadata = false, int entropyBytes = 16, bool trailing = false)
    {
        var sof = new byte[] { 8, (byte)(height >> 8), (byte)height, (byte)(width >> 8), (byte)width, 1, 1, 0x11, 0 };
        return Join(
            [0xFF, 0xD8],
            metadata ? JpegSegment(0xE1, Join(Encoding.ASCII.GetBytes("Exif\0\0"), ExifMarker)) : [],
            metadata ? JpegSegment(0xFE, Encoding.ASCII.GetBytes("comment-secret")) : [],
            JpegSegment(0xDB, new byte[65]),
            JpegSegment(0xC0, sof),
            JpegSegment(0xDA, [1, 1, 0, 0, 63, 0]),
            Enumerable.Repeat((byte)0x11, entropyBytes).ToArray(),
            [0xFF, 0xD9],
            trailing ? ExifMarker : []);
    }

    public static byte[] JpegWithScans(int scans)
    {
        var jpeg = Jpeg();
        var scan = Join(JpegSegment(0xDA, [1, 1, 0, 0, 63, 0]), Enumerable.Repeat((byte)0x11, 4).ToArray());
        return Join(jpeg[..^2], Join(Enumerable.Repeat(scan, scans - 1).ToArray()), [0xFF, 0xD9]);
    }

    public static byte[] JpegWithSegmentLength(int length) => Join([0xFF, 0xD8, 0xFF, 0xE1], Be16(length), new byte[4]);

    public static byte[] PngChunk(string type, byte[] data, bool badCrc = false)
    {
        var body = Join(Encoding.ASCII.GetBytes(type), data);
        var crc = 0xFFFFFFFFu;
        foreach (var b in body)
        {
            crc ^= b;
            for (var k = 0; k < 8; k++) crc = (crc & 1) != 0 ? 0xEDB88320 ^ (crc >> 1) : crc >> 1;
        }

        crc = ~crc ^ (badCrc ? 1u : 0u);
        var length = new byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(length, (uint)data.Length);
        var tail = new byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(tail, crc);
        return Join(length, body, tail);
    }

    public static byte[] Png(int width = 8, int height = 8, bool metadata = false, bool badMetadataCrc = false, bool badIdatCrc = false)
    {
        var ihdr = new byte[13];
        BinaryPrimitives.WriteUInt32BigEndian(ihdr, (uint)width);
        BinaryPrimitives.WriteUInt32BigEndian(ihdr.AsSpan(4), (uint)height);
        ihdr[8] = 8;
        return Join(
            [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
            PngChunk("IHDR", ihdr),
            metadata ? PngChunk("tEXt", Join(Encoding.ASCII.GetBytes("Comment\0"), ExifMarker), badMetadataCrc) : [],
            metadata ? PngChunk("eXIf", ExifMarker) : [],
            PngChunk("IDAT", [1, 2, 3, 4], badIdatCrc),
            PngChunk("IEND", []),
            metadata ? ExifMarker : []);
    }

    private static byte[] Le32(int value) => BitConverter.GetBytes(value);

    private static byte[] RiffChunk(string type, byte[] payload)
        => Join(Encoding.ASCII.GetBytes(type), Le32(payload.Length), payload, payload.Length % 2 == 1 ? [0] : []);

    private static byte[] Riff(params byte[][] chunks)
    {
        var body = Join(chunks);
        return Join(Encoding.ASCII.GetBytes("RIFF"), Le32(body.Length + 4), Encoding.ASCII.GetBytes("WEBP"), body);
    }

    private static byte[] Vp8(int width, int height)
        => RiffChunk("VP8 ", Join([0x10, 0, 0, 0x9D, 0x01, 0x2A], BitConverter.GetBytes((ushort)width), BitConverter.GetBytes((ushort)height), [0, 0, 0]));

    private static byte[] Vp8x(byte flags, int width, int height)
        => RiffChunk("VP8X", [flags, 0, 0, 0, (byte)(width - 1), (byte)((width - 1) >> 8), 0, (byte)(height - 1), (byte)((height - 1) >> 8), 0]);

    public static byte[] WebP(int width = 8, int height = 8) => Riff(Vp8(width, height));

    public static byte[] WebPWithMetadata(int width = 8, int height = 8)
        => Riff(Vp8x(0x2C, width, height), Vp8(width, height), RiffChunk("EXIF", ExifMarker));

    public static byte[] AnimatedWebP(int width = 8, int height = 8)
        => Riff(Vp8x(0x02, width, height), RiffChunk("ANIM", new byte[6]), Vp8(width, height));

    public static byte[] Gif() => Join(Encoding.ASCII.GetBytes("GIF89a"), new byte[16]);

    public static byte[] Polyglot() => Join(Encoding.ASCII.GetBytes("<html><script>alert(1)</script>"), Jpeg());

    public static string Base64(byte[] data) => Convert.ToBase64String(data);
}
