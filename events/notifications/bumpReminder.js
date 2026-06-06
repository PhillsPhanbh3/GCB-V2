const fs = require("fs");

const DISBOARD_ID = "302050872383242240";
const BUMP_COOLDOWN = 2 * 60 * 60 * 1000; // 2 hours in ms
const CONFIG_FILE = "./bump-config.json";

// In-memory store: guildId -> { channelId, roleId, timer }
const guildConfig = new Map();

// ─── Persistence ─────────────────────────────────────────────────────────────

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return;
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    for (const [guildId, config] of Object.entries(data)) {
      guildConfig.set(guildId, { ...config, timer: null });
    }
    console.log(`[BumpReminder] Loaded config for ${guildConfig.size} guild(s).`);
  } catch (err) {
    console.error("[BumpReminder] Failed to load config:", err);
  }
}

function saveConfig() {
  const data = {};
  for (const [guildId, config] of guildConfig.entries()) {
    data[guildId] = { channelId: config.channelId, roleId: config.roleId };
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

// ─── Setup ───────────────────────────────────────────────────────────────────

function setupBumpReminder(guildId, channelId, roleId) {
  const existing = guildConfig.get(guildId);
  if (existing?.timer) clearTimeout(existing.timer);
  guildConfig.set(guildId, { channelId, roleId, timer: null });
  saveConfig();
}

function removeBumpReminder(guildId) {
  const existing = guildConfig.get(guildId);
  if (existing?.timer) clearTimeout(existing.timer);
  guildConfig.delete(guildId);
  saveConfig();
}

function getConfig(guildId) {
  return guildConfig.get(guildId) ?? null;
}

// ─── Message Handler ──────────────────────────────────────────────────────────

async function handleMessage(message) {
  // Guard against system/webhook messages that have no author
  if (!message.author) return;

  // DEBUG: log every message from DISBOARD so we can see what it sends
  if (message.author.id === DISBOARD_ID) {
    console.log("[BumpReminder] DISBOARD message detected:");
    console.log("  Guild:", message.guild?.id ?? "DM");
    console.log("  Embeds:", message.embeds.length);
    if (message.embeds[0]) {
      console.log("  Embed description:", message.embeds[0].description);
    }
  }

  if (message.author.id !== DISBOARD_ID) return;
  if (!message.guild) return;
  if (!message.embeds.length) return;

  const embed = message.embeds[0];
  const isBumpSuccess = embed.description?.includes("Bump done");

  console.log("[BumpReminder] isBumpSuccess:", isBumpSuccess);

  if (!isBumpSuccess) return;

  const config = guildConfig.get(message.guild.id);

  console.log("[BumpReminder] Guild config:", config);

  if (!config) {
    console.log(
      "[BumpReminder] No config found for guild",
      message.guild.id,
      "— run /setup-bump set first."
    );
    return;
  }

  // Clear any old pending timer
  if (config.timer) clearTimeout(config.timer);

  // Send confirmation
  const channel = message.guild.channels.cache.get(config.channelId);

  console.log("[BumpReminder] Sending to channel:", config.channelId, "— found:", !!channel);

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
    .catch((err) => console.error("[BumpReminder] Failed to send confirmation:", err));

  // Schedule reminder
  config.timer = setTimeout(async () => {
    const rolePing = config.roleId ? `<@&${config.roleId}>` : "";
    await channel
      .send({
        content: rolePing || null,
        embeds: [
          {
            color: 0xfee75c,
            title: "⏰ Time to bump the server!",
            description: "Run </bump:947088344167366698> to keep us at the top of **DISBOARD**.",
            footer: { text: "Bump now to bring in new members!" },
          },
        ],
      })
      .catch((err) => console.error("[BumpReminder] Failed to send reminder:", err));

    config.timer = null;
  }, BUMP_COOLDOWN);
}

module.exports = { loadConfig, setupBumpReminder, removeBumpReminder, getConfig, handleMessage };
