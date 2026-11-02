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
            entity.HasOne(h => h.User)
                  .WithMany(u => u.Habits)
                  .HasForeignKey(h => h.UserId)
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
            entity.HasOne(s => s.User)
                  .WithMany(u => u.PushSubscriptions)
                  .HasForeignKey(s => s.UserId)
                  .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
