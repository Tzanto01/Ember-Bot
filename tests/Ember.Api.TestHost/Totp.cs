using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;

namespace Ember.Api.TestHost;

/// <summary>RFC 6238 codes (SHA-1, 30-second steps, 6 digits) as authenticator apps compute them from Identity's shared key.</summary>
public static class Totp
{
    /// <param name="sharedKey">The Base32 key from <c>POST /api/me/2fa/setup</c>.</param>
    /// <param name="offsetSteps">Time steps away from now (negative for the past).</param>
    public static string Code(string sharedKey, int offsetSteps = 0)
    {
        var step = DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30 + offsetSteps;
        Span<byte> counter = stackalloc byte[8];
        BinaryPrimitives.WriteInt64BigEndian(counter, step);
        var hash = HMACSHA1.HashData(FromBase32(sharedKey), counter);
        var offset = hash[^1] & 0x0F;
        var value = BinaryPrimitives.ReadInt32BigEndian(hash.AsSpan(offset)) & 0x7FFFFFFF;
        return (value % 1_000_000).ToString("D6", CultureInfo.InvariantCulture);
    }

    private static byte[] FromBase32(string input)
    {
        const string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        var bytes = new List<byte>();
        int buffer = 0, bits = 0;
        foreach (var c in input.TrimEnd('=').ToUpperInvariant())
        {
            buffer = (buffer << 5) | alphabet.IndexOf(c);
            bits += 5;
            if (bits < 8) continue;
            bits -= 8;
            bytes.Add((byte)(buffer >> bits));
        }
        return [.. bytes];
    }
}
