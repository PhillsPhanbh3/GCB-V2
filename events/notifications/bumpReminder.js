const BumpReminderModel = require("../../schema/bumpReminder");
const logger = require("../../utils/logger");

const DISBOARD_ID = "302050872383242240";
const BUMP_COOLDOWN = 2 * 60 * 60 * 1000; // 2 hours in ms

// In-memory store: guildId -> { channelId, roleId, timer }
// `timer` is a live setTimeout handle and is never persisted — only
// NextReminderAt (in Mongo) survives a restart.
const guildConfig = new Map();

let botClient = null;

// ─── Persistence ─────────────────────────────────────────────────────────────

/**
 * Loads every guild's bump config from Mongo into memory, and recovers any
 * reminder that should already be pending (or already overdue) after a
 * restart/redeploy.
 * @param {import('discord.js').Client} client
 */
async function loadConfig(client) {
  botClient = client;

  try {
    const docs = await BumpReminderModel.find({});

    for (const doc of docs) {
      guildConfig.set(doc.Guild, {
        channelId: doc.ChannelId,
        roleId: doc.RoleId ?? null,
        timer: null,
      });

      if (doc.NextReminderAt) {
        const remaining = doc.NextReminderAt - Date.now();
        if (remaining <= 0) {
          // Cooldown already elapsed while the bot was offline — fire now.
          await fireReminder(doc.Guild);
        } else {
          scheduleReminderTimer(doc.Guild, remaining);
        }
      }
    }

    logger.info(`[BumpReminder] Loaded config for ${docs.length} guild(s).`);
  } catch (err) {
    logger.error("[BumpReminder] Failed to load config from Mongo:", err);
  }
}

// ─── Setup ───────────────────────────────────────────────────────────────────

async function setupBumpReminder(guildId, channelId, roleId) {
  const existing = guildConfig.get(guildId);
  if (existing?.timer) clearTimeout(existing.timer);

  guildConfig.set(guildId, { channelId, roleId, timer: null });

  await BumpReminderModel.findOneAndUpdate(
    { Guild: guildId },
    { Guild: guildId, ChannelId: channelId, RoleId: roleId },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

async function removeBumpReminder(guildId) {
  const existing = guildConfig.get(guildId);
  if (existing?.timer) clearTimeout(existing.timer);

  guildConfig.delete(guildId);
  await BumpReminderModel.deleteOne({ Guild: guildId });
}

function getConfig(guildId) {
  return guildConfig.get(guildId) ?? null;
}

// ─── Reminder Scheduling ──────────────────────────────────────────────────────

function scheduleReminderTimer(guildId, delayMs) {
  const config = guildConfig.get(guildId);
  if (!config) return;

  if (config.timer) clearTimeout(config.timer);

  config.timer = setTimeout(() => {
    fireReminder(guildId).catch((err) => logger.error(`[BumpReminder] Failed to fire reminder for ${guildId}:`, err));
  }, delayMs);
}

async function fireReminder(guildId) {
  const config = guildConfig.get(guildId);
  if (!config || !botClient) return;

  config.timer = null;

  const channel = await botClient.channels.fetch(config.channelId).catch(() => null);
  if (channel) {
    const rolePing = config.roleId ? `<@&${config.roleId}>` : "";
    await channel
      .send({
        content: rolePing || null,
        embeds: [
          {
            color: 0xfee75c,
            title: "⏰ Time to bump the server!",
            description: "Run `/bump` to keep us at the top of **DISBOARD**.",
            footer: { text: "Bump now to bring in new members!" },
          },
        ],
      })
      .catch((err) => logger.error("[BumpReminder] Failed to send reminder:", err));
  }

  await BumpReminderModel.findOneAndUpdate({ Guild: guildId }, { NextReminderAt: null }).catch((err) =>
    logger.error(`[BumpReminder] Failed to clear NextReminderAt for ${guildId}:`, err)
  );
}

// ─── Message Handler ──────────────────────────────────────────────────────────

async function handleMessage(message) {
  // Guard against system/webhook messages that have no author
  if (!message.author) return;
  if (message.author.id !== DISBOARD_ID) return;
  if (!message.guild) return;
  if (!message.embeds.length) return;

  const embed = message.embeds[0];
  const isBumpSuccess = embed.description?.includes("Bump done");
  if (!isBumpSuccess) return;

  const config = guildConfig.get(message.guild.id);

  if (!config) {
    logger.warn(`[BumpReminder] No config found for guild ${message.guild.id} — run /bump-reminder setup first.`);
    return;
  }

  if (config.timer) clearTimeout(config.timer);

  const channel = message.guild.channels.cache.get(config.channelId);
  if (!channel) return;

  await channel
    .send({
      embeds: [
        {
          color: 0x57f287,
          description: "✅ **Server bumped!** I'll remind you when it's time to bump again.",
          footer: { text: "Reminder in 2 hours" },
          timestamp: new Date(Date.now() + BUMP_COOLDOWN).toISOString(),
        },
      ],
    })
    .catch((err) => logger.error("[BumpReminder] Failed to send confirmation:", err));

  const nextReminderAt = Date.now() + BUMP_COOLDOWN;

  await BumpReminderModel.findOneAndUpdate({ Guild: message.guild.id }, { NextReminderAt: nextReminderAt }).catch((err) =>
    logger.error(`[BumpReminder] Failed to persist NextReminderAt for ${message.guild.id}:`, err)
  );

  scheduleReminderTimer(message.guild.id, BUMP_COOLDOWN);
}

module.exports = { loadConfig, setupBumpReminder, removeBumpReminder, getConfig, handleMessage };