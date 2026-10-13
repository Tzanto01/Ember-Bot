using Ember.Bot.Models;
using Microsoft.EntityFrameworkCore;

namespace Ember.Bot.Data;

public class EmberDbContext : DbContext
{
    public EmberDbContext(DbContextOptions<EmberDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<Habit> Habits => Set<Habit>();
    public DbSet<HabitLog> HabitLogs => Set<HabitLog>();
    public DbSet<DayMark> DayMarks => Set<DayMark>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(entity =>
        {
            entity.HasKey(u => u.DiscordUserId);
            entity.Property(u => u.Timezone).HasMaxLength(64).IsRequired();
            entity.Property(u => u.ConsentPolicyVersion).HasMaxLength(16);
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
    }
}
