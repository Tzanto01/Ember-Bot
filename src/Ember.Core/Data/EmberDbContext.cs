using Ember.Core.Models;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Ember.Core.Data;

/// <summary>
/// Ember's data plus the Identity user tables (no roles). Uses Identity's default schema version:
/// a process that sets <c>IdentityOptions.Stores.SchemaVersion</c> (for passkeys) changes the model and needs a migration.
/// </summary>
public class EmberDbContext : IdentityUserContext<User, Guid>
{
    public EmberDbContext(DbContextOptions<EmberDbContext> options) : base(options) { }

    public DbSet<Habit> Habits => Set<Habit>();
    public DbSet<HabitLog> HabitLogs => Set<HabitLog>();
    public DbSet<DayMark> DayMarks => Set<DayMark>();
    public DbSet<PushSubscription> PushSubscriptions => Set<PushSubscription>();
    public DbSet<Routine> Routines => Set<Routine>();
    public DbSet<DayNote> DayNotes => Set<DayNote>();
    public DbSet<Mood> Moods => Set<Mood>();
    public DbSet<JournalKey> JournalKeys => Set<JournalKey>();
    public DbSet<ReminderMessage> ReminderMessages => Set<ReminderMessage>();
    public DbSet<AuthSession> AuthSessions => Set<AuthSession>();
    public DbSet<ReminderActionToken> ReminderActionTokens => Set<ReminderActionToken>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<User>(entity =>
        {
            entity.Property(u => u.Timezone).HasMaxLength(64).IsRequired();
            entity.Property(u => u.ConsentPolicyVersion).HasMaxLength(16);
            entity.Property(u => u.Theme).HasMaxLength(32);
            entity.HasMany(u => u.Logins)
                  .WithOne()
                  .HasForeignKey(l => l.UserId)
                  .IsRequired();
        });

        modelBuilder.Entity<Habit>(entity =>
        {
            entity.HasKey(h => h.Id);
            entity.Property(h => h.Name).HasMaxLength(100).IsRequired();
            entity.HasIndex(h => h.NextReminderUtc);
            entity.HasIndex(h => h.SecondReminderUtc);
            entity.Property(h => h.TimesPerDay).HasDefaultValue(1);
            entity.HasOne(h => h.User)
                  .WithMany(u => u.Habits)
                  .HasForeignKey(h => h.UserId)
                  .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(h => h.Routine)
                  .WithMany(r => r.Habits)
                  .HasForeignKey(h => h.RoutineId)
                  .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<Routine>(entity =>
        {
            entity.HasKey(r => r.Id);
            entity.Property(r => r.Name).HasMaxLength(50).IsRequired();
            entity.HasIndex(r => r.NextReminderUtc);
            entity.HasIndex(r => r.SecondReminderUtc);
            entity.HasOne(r => r.User)
                  .WithMany(u => u.Routines)
                  .HasForeignKey(r => r.UserId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ReminderMessage>(entity =>
        {
            entity.HasKey(m => m.Id);
            entity.HasIndex(m => m.MessageId);
            entity.HasOne<User>()
                  .WithMany()
                  .HasForeignKey(m => m.UserId)
                  .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<Habit>()
                  .WithMany()
                  .HasForeignKey(m => m.HabitId)
                  .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<Routine>()
                  .WithMany()
                  .HasForeignKey(m => m.RoutineId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<DayNote>(entity =>
        {
            entity.HasKey(n => n.Id);
            entity.Property(n => n.Text).HasMaxLength(2000);
            entity.Property(n => n.Mood).HasMaxLength(32);
            entity.Property(n => n.CipherIv).HasMaxLength(64);
            entity.Property(n => n.CipherText).HasMaxLength(16384);
            entity.HasIndex(n => new { n.UserId, n.Date }).IsUnique();
            entity.HasOne(n => n.User)
                  .WithMany(u => u.DayNotes)
                  .HasForeignKey(n => n.UserId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Mood>(entity =>
        {
            entity.HasKey(m => m.Id);
            entity.Property(m => m.Label).HasMaxLength(24);
            entity.Property(m => m.Emoji).HasMaxLength(32);
            entity.Property(m => m.CipherIv).HasMaxLength(64);
            entity.Property(m => m.CipherText).HasMaxLength(16384);
            entity.HasIndex(m => m.UserId);
            entity.HasOne(m => m.User)
                  .WithMany(u => u.Moods)
                  .HasForeignKey(m => m.UserId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<JournalKey>(entity =>
        {
            entity.HasKey(k => k.UserId);
            entity.Property(k => k.PassphraseSalt).HasMaxLength(512).IsRequired();
            entity.Property(k => k.PassphraseIv).HasMaxLength(512).IsRequired();
            entity.Property(k => k.PassphraseWrapped).HasMaxLength(512).IsRequired();
            entity.Property(k => k.RecoverySalt).HasMaxLength(512).IsRequired();
            entity.Property(k => k.RecoveryIv).HasMaxLength(512).IsRequired();
            entity.Property(k => k.RecoveryWrapped).HasMaxLength(512).IsRequired();
            entity.HasOne(k => k.User)
                  .WithOne(u => u.JournalKey)
                  .HasForeignKey<JournalKey>(k => k.UserId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<HabitLog>(entity =>
        {
            entity.HasKey(l => l.Id);
            // One log entry per habit per day
            entity.HasIndex(l => new { l.HabitId, l.Date }).IsUnique();
            entity.HasOne(l => l.Habit)
                  .WithMany(h => h.Logs)
                  .HasForeignKey(l => l.HabitId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<DayMark>(entity =>
        {
            entity.HasKey(m => m.Id);
            entity.HasIndex(m => new { m.UserId, m.Date, m.Kind }).IsUnique();
            entity.HasOne(m => m.User)
                  .WithMany(u => u.DayMarks)
                  .HasForeignKey(m => m.UserId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<PushSubscription>(entity =>
        {
            entity.HasKey(s => s.Id);
            entity.Property(s => s.Endpoint).HasMaxLength(2048).IsRequired();
            entity.Property(s => s.P256dh).HasMaxLength(256).IsRequired();
            entity.Property(s => s.Auth).HasMaxLength(64).IsRequired();
            entity.HasIndex(s => s.Endpoint).IsUnique();
            entity.HasIndex(s => s.UserId);
            entity.HasIndex(s => s.SessionId);
            entity.HasOne(s => s.User)
                  .WithMany(u => u.PushSubscriptions)
                  .HasForeignKey(s => s.UserId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<AuthSession>(entity =>
        {
            entity.HasKey(s => s.Id);
            entity.Property(s => s.Id).ValueGeneratedNever();
            entity.HasIndex(s => s.UserId);
            entity.HasIndex(s => s.ExpiresUtc);
            entity.HasOne<User>()
                  .WithMany()
                  .HasForeignKey(s => s.UserId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ReminderActionToken>(entity =>
        {
            entity.HasKey(t => t.Id);
            entity.Property(t => t.TokenHash).HasMaxLength(32).IsRequired();
            entity.HasIndex(t => t.TokenHash).IsUnique();
            entity.HasIndex(t => t.ExpiresUtc);
            entity.HasOne<User>()
                  .WithMany()
                  .HasForeignKey(t => t.UserId)
                  .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<Habit>()
                  .WithMany()
                  .HasForeignKey(t => t.HabitId)
                  .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
