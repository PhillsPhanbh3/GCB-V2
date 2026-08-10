const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} = require("discord.js");
const { LogError } = require("../../../../utils/LogError");
const {
  setupBumpReminder,
  removeBumpReminder,
  getConfig,
} = require("../../../../events/notifications/bumpReminder");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("bump-reminder")
    .setDescription("Configure DISBOARD bump reminders for this server.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName("setup")
        .setDescription("Set the channel (and optional role) for bump reminders.")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Channel to post bump confirmations and reminders in.")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addRoleOption((opt) =>
          opt
            .setName("role")
            .setDescription("Role to ping when it's time to bump again (optional).")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("status").setDescription("View the current bump reminder configuration.")
    )
    .addSubcommand((sub) =>
      sub.setName("remove").setDescription("Disable bump reminders for this server.")
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const client = interaction.client;

    try {
      if (sub === "setup") {
        const channel = interaction.options.getChannel("channel");
        const role = interaction.options.getRole("role");

        const permissions = channel.permissionsFor(interaction.guild.members.me);
        if (
          !permissions?.has(PermissionFlagsBits.SendMessages) ||
          !permissions?.has(PermissionFlagsBits.EmbedLinks)
        ) {
          return interaction.reply({
            content: `I need **Send Messages** and **Embed Links** permissions in ${channel} to post bump reminders there.`,
            flags: MessageFlags.Ephemeral,
          });
        }

        await setupBumpReminder(interaction.guild.id, channel.id, role?.id ?? null);

        const embed = new EmbedBuilder()
          .setColor("Green")
          .setTitle("✅ Bump Reminder Configured")
          .setDescription(
            `I'll watch for DISBOARD bump confirmations and post reminders in ${channel}.` +
              (role ? `\nI'll ping ${role} when it's time to bump again.` : "")
          )
          .setFooter({ text: "Run /bump once in that channel to kick off the first reminder cycle." })
          .setTimestamp();

        return interaction.reply({ embeds: [embed] });
      }

      if (sub === "status") {
        const config = getConfig(interaction.guild.id);

        if (!config) {
          return interaction.reply({
            content:
              "Bump reminders aren't set up for this server yet. Run `/bump-reminder setup` to configure them.",
            flags: MessageFlags.Ephemeral,
          });
        }

        const embed = new EmbedBuilder()
          .setColor("Blue")
          .setTitle("⏰ Bump Reminder Status")
          .addFields(
            { name: "Channel", value: `<#${config.channelId}>`, inline: true },
            { name: "Role", value: config.roleId ? `<@&${config.roleId}>` : "None set", inline: true },
            {
              name: "Pending Reminder",
              value: config.timer ? "Yes, scheduled" : "No — run `/bump` to start the cycle",
              inline: true,
            }
          )
          .setTimestamp();

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      if (sub === "remove") {
        const config = getConfig(interaction.guild.id);

        if (!config) {
          return interaction.reply({
            content: "Bump reminders aren't set up for this server.",
            flags: MessageFlags.Ephemeral,
          });
        }

        await removeBumpReminder(interaction.guild.id);

        return interaction.reply({
          content: "Bump reminders have been disabled for this server.",
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      client.logger.error(`Error executing /bump-reminder ${sub}: ${error.message}`, error);
      LogError(error, client, "Slash Command: /bump-reminder");

      const payload = {
        content: "An error occurred while running this command. Please try again later.",
        flags: MessageFlags.Ephemeral,
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload);
      } else {
        await interaction.reply(payload);
      }
    }
  },
};