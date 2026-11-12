using Ember.Core.Services;
using FluentAssertions;

namespace Ember.Api.Tests;

public class FeedbackImagesTests
{
    private static bool Contains(byte[] data, byte[] needle) => data.AsSpan().IndexOf(needle) >= 0;

    [Fact]
    public void A_jpeg_loses_its_exif_gps_and_comment_and_the_bytes_after_the_end_but_keeps_the_picture_data()
    {
        var result = FeedbackImages.Sanitize(SyntheticImages.Jpeg(metadata: true, trailing: true), out var error);

        error.Should().BeNull();
        result!.ContentType.Should().Be("image/jpeg");
        result.Data.Should().Equal(SyntheticImages.Jpeg());
        Contains(result.Data, SyntheticImages.ExifMarker).Should().BeFalse();
    }

    [Fact]
    public void A_png_loses_its_text_and_exif_chunks_and_the_bytes_after_the_end_but_keeps_the_picture_data()
    {
        var result = FeedbackImages.Sanitize(SyntheticImages.Png(metadata: true), out var error);

        error.Should().BeNull();
        result!.ContentType.Should().Be("image/png");
        result.Data.Should().Equal(SyntheticImages.Png());
    }

    [Fact]
    public void A_png_with_a_broken_crc_on_a_kept_chunk_is_rejected_while_a_broken_crc_on_a_dropped_chunk_is_not_looked_at()
    {
        FeedbackImages.Sanitize(SyntheticImages.Png(badIdatCrc: true), out var error).Should().BeNull();
        error.Should().Be(FeedbackImages.Unreadable);

        FeedbackImages.Sanitize(SyntheticImages.Png(metadata: true, badMetadataCrc: true), out _).Should().NotBeNull();
    }

    [Fact]
    public void A_webp_loses_its_exif_chunk_and_the_metadata_flags_and_gets_a_correct_riff_size()
    {
        var result = FeedbackImages.Sanitize(SyntheticImages.WebPWithMetadata(), out var error);

        error.Should().BeNull();
        result!.ContentType.Should().Be("image/webp");
        Contains(result.Data, SyntheticImages.ExifMarker).Should().BeFalse();
        Contains(result.Data, "EXIF"u8.ToArray()).Should().BeFalse();
        BitConverter.ToUInt32(result.Data, 4).Should().Be((uint)(result.Data.Length - 8));
        result.Data[20].Should().Be(0, "the ICC, alpha, EXIF, XMP and animation flags of the source are cleared");
        FeedbackImages.Sanitize(result.Data, out _).Should().NotBeNull("the output is itself a valid picture");
    }

    [Fact]
    public void A_plain_webp_passes_unchanged()
        => FeedbackImages.Sanitize(SyntheticImages.WebP(), out _)!.Data.Should().Equal(SyntheticImages.WebP());

    [Fact]
    public void An_animated_webp_is_rejected_as_a_still_pictures_only_case()
    {
        FeedbackImages.Sanitize(SyntheticImages.AnimatedWebP(), out var error).Should().BeNull();

        error.Should().Contain("no animations");
    }

    [Fact]
    public void A_gif_and_a_polyglot_with_a_leading_html_part_are_rejected_by_their_magic_bytes()
    {
        FeedbackImages.Sanitize(SyntheticImages.Gif(), out var gifError).Should().BeNull();
        FeedbackImages.Sanitize(SyntheticImages.Polyglot(), out var polyglotError).Should().BeNull();

        gifError.Should().NotBeNullOrEmpty();
        polyglotError.Should().NotBeNullOrEmpty();
    }

    [Fact]
    public void Truncated_or_oversized_lengths_are_rejected_without_throwing()
    {
        var jpeg = SyntheticImages.Jpeg();
        var inputs = new[]
        {
            SyntheticImages.JpegWithSegmentLength(0xFFFF),
            jpeg[..(jpeg.Length / 2)],
            jpeg[..3],
            SyntheticImages.Png()[..30],
            SyntheticImages.Png()[..9],
            SyntheticImages.WebP()[..15],
            SyntheticImages.Join("RIFF"u8.ToArray(), [0xFF, 0xFF, 0xFF, 0xFF], "WEBP"u8.ToArray(), "VP8 "u8.ToArray(), [0xFF, 0xFF, 0xFF, 0x7F]),
        };

        foreach (var input in inputs)
        {
            FeedbackImages.Sanitize(input, out var error).Should().BeNull();
            error.Should().NotBeNullOrEmpty();
        }
    }

    [Fact]
    public void A_webp_chunk_size_near_the_uint_limit_is_rejected_without_throwing()
    {
        var input = SyntheticImages.Join("RIFF"u8.ToArray(), [0x0C, 0, 0, 0], "WEBP"u8.ToArray(), "VP8 "u8.ToArray(), [0xFF, 0xFF, 0xFF, 0xFF]);

        FeedbackImages.Sanitize(input, out var error).Should().BeNull();
        error.Should().Be(FeedbackImages.Unreadable);
    }

    [Fact]
    public void A_jpeg_may_have_up_to_64_scans_and_one_with_more_is_rejected()
    {
        FeedbackImages.Sanitize(SyntheticImages.JpegWithScans(FeedbackImages.MaxJpegScans), out var error).Should().NotBeNull();
        error.Should().BeNull();

        FeedbackImages.Sanitize(SyntheticImages.JpegWithScans(FeedbackImages.MaxJpegScans + 1), out error).Should().BeNull();
        error.Should().Be(FeedbackImages.Unreadable);
    }

    [Theory]
    [InlineData(4096, 4096, true)]
    [InlineData(4097, 8, false)]
    [InlineData(8, 4097, false)]
    public void A_side_over_4096_pixels_is_rejected_in_every_format(int width, int height, bool accepted)
    {
        var results = new[]
        {
            FeedbackImages.Sanitize(SyntheticImages.Jpeg(width, height), out _),
            FeedbackImages.Sanitize(SyntheticImages.Png(width, height), out _),
            FeedbackImages.Sanitize(SyntheticImages.WebP(width, height), out _),
        };

        results.All(r => r is not null).Should().Be(accepted);
        results.Any(r => r is not null).Should().Be(accepted);
    }
}
