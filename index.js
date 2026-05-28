const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// ──────────────────────────────────────────
// Configuration — à adapter à ton serveur
// ──────────────────────────────────────────
const LFG_CHANNEL_ID = '1509506151866433686';
const ROLE_TANK_ID   = '1415752673910718634';
const ROLE_HEAL_ID   = '1415752675609284629';
const ROLE_DPS_ID    = '1415752676930486347';

// ──────────────────────────────────────────
// Donjons Mythic+ — Saison 1 de Midnight
// ──────────────────────────────────────────
const DUNGEONS = [
  { label: 'Terrasse des Magistères',    value: 'magisters',    emoji: '🌙' },
  { label: 'Flèche de Coursevent',       value: 'coursevent',   emoji: '💨' },
  { label: 'Gouffre de la Sombrevoie',   value: 'sombrevoie',   emoji: '🌑' },
  { label: 'Place Parhélion',            value: 'parhelion',    emoji: '☀️' },
  { label: 'Orée-du-Ciel',              value: 'oree',         emoji: '🪶' },
  { label: 'Siège du Triumvirat',        value: 'triumvirat',   emoji: '⚔️' },
  { label: "Académie d'Algeth'ar",       value: 'algethar',     emoji: '📚' },
  { label: 'Fosse de Saron',             value: 'saron',        emoji: '❄️' },
];

const sessions = new Map();
const groups = new Map();

// ──────────────────────────────────────────
// Enregistrement de la commande slash /lfm
// ──────────────────────────────────────────
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('lfm')
      .setDescription('Créer un groupe Mythic+ en quelques clics')
      .toJSON()
  ];
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log('✅ Commande /lfm enregistrée');
}

// ──────────────────────────────────────────
// Message permanent avec bouton dans le channel LFG
// ──────────────────────────────────────────
async function setupLFGChannel(client) {
  const channel = await client.channels.fetch(LFG_CHANNEL_ID).catch(() => null);
  if (!channel) { console.log('⚠️ Channel LFG introuvable, vérifie LFG_CHANNEL_ID'); return; }

  // Supprime les anciens messages du bot pour éviter les doublons
  const messages = await channel.messages.fetch({ limit: 20 });
  const botMessages = messages.filter(m => m.author.id === client.user.id && m.components.length > 0);
  for (const msg of botMessages.values()) await msg.delete().catch(() => {});

  const embed = new EmbedBuilder()
    .setTitle('🗝️ Groupe Mythic+ — Saison 1 Midnight')
    .setDescription('Clique sur le bouton ci-dessous pour créer un groupe en quelques clics.\nChoisis ton donjon, le niveau de clé et les rôles recherchés.')
    .setColor(0x5865f2)
    .setFooter({ text: 'Le menu de création est visible uniquement par toi.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('open_lfm')
      .setLabel('🗝️ Créer un groupe')
      .setStyle(ButtonStyle.Primary)
  );

  await channel.send({ embeds: [embed], components: [row] });
  console.log('✅ Message permanent LFG envoyé');
}

// ──────────────────────────────────────────
// Construction des composants UI
// ──────────────────────────────────────────
function buildDungeonSelect() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('select_dungeon')
      .setPlaceholder('🗺️ Choisir un donjon...')
      .addOptions(DUNGEONS.map(d => ({ label: d.label, value: d.value, emoji: d.emoji })))
  );
}

function buildLevelSelect() {
  const levels = [2,3,4,5,6,7,8,9,10,11,12,13,14,15,17,20];
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('select_level')
      .setPlaceholder('🔑 Choisir le niveau de clé...')
      .addOptions(levels.map(l => ({ label: `+${l}`, value: String(l) })))
  );
}

function buildRoleButtons(selectedRoles = new Set()) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('toggle_tank')
      .setLabel('🛡️ Tank')
      .setStyle(selectedRoles.has('tank') ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('toggle_heal')
      .setLabel('💚 Heal')
      .setStyle(selectedRoles.has('heal') ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('toggle_dps')
      .setLabel('⚔️ DPS')
      .setStyle(selectedRoles.has('dps') ? ButtonStyle.Danger : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('publish_group')
      .setLabel('Publier le groupe ➜')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(selectedRoles.size === 0)
  );
}

function buildGroupEmbed(dungeon, level, rolesNeeded, members) {
  const dungeonLabel = DUNGEONS.find(d => d.value === dungeon)?.label || dungeon;
  const dungeonEmoji = DUNGEONS.find(d => d.value === dungeon)?.emoji || '🗝️';
  const roleLines = [];

  if (rolesNeeded.has('tank')) {
    const t = members.tank ? `<@${members.tank}>` : '*En attente...*';
    roleLines.push(`🛡️ **Tank** — ${t}`);
  }
  if (rolesNeeded.has('heal')) {
    const h = members.heal ? `<@${members.heal}>` : '*En attente...*';
    roleLines.push(`💚 **Heal** — ${h}`);
  }
  if (rolesNeeded.has('dps')) {
    const filled = members.dps.map(id => `<@${id}>`);
    const needed = 3 - members.dps.length;
    const waiting = needed > 0 ? Array(needed).fill('*En attente...*') : [];
    [...filled, ...waiting].forEach(d => roleLines.push(`⚔️ **DPS** — ${d}`));
  }

  const totalNeeded =
    (rolesNeeded.has('tank') ? 1 : 0) +
    (rolesNeeded.has('heal') ? 1 : 0) +
    (rolesNeeded.has('dps') ? 3 : 0);
  const totalFilled =
    (members.tank ? 1 : 0) +
    (members.heal ? 1 : 0) +
    members.dps.length;
  const isFull = totalFilled >= totalNeeded;

  return new EmbedBuilder()
    .setTitle(`${dungeonEmoji} ${dungeonLabel} — Clé +${level}`)
    .setDescription(roleLines.join('\n'))
    .setColor(isFull ? 0x57ab5a : 0x5865f2)
    .setFooter({ text: isFull ? '✅ Groupe complet !' : `${totalFilled}/${totalNeeded} joueurs • Saison 1 Midnight` })
    .setTimestamp();
}

function buildJoinButtons(rolesNeeded) {
  const row = new ActionRowBuilder();
  if (rolesNeeded.has('tank')) row.addComponents(new ButtonBuilder().setCustomId('join_tank').setLabel('🛡️ Je joue Tank').setStyle(ButtonStyle.Secondary));
  if (rolesNeeded.has('heal')) row.addComponents(new ButtonBuilder().setCustomId('join_heal').setLabel('💚 Je joue Heal').setStyle(ButtonStyle.Secondary));
  if (rolesNeeded.has('dps'))  row.addComponents(new ButtonBuilder().setCustomId('join_dps').setLabel('⚔️ Je joue DPS').setStyle(ButtonStyle.Secondary));
  row.addComponents(new ButtonBuilder().setCustomId('leave_group').setLabel('Quitter').setStyle(ButtonStyle.Danger));
  return row;
}

function buildPingMessage(rolesNeeded, dungeon, level) {
  const dungeonLabel = DUNGEONS.find(d => d.value === dungeon)?.label || dungeon;
  const pings = [];
  if (rolesNeeded.has('tank')) pings.push(`<@&${ROLE_TANK_ID}>`);
  if (rolesNeeded.has('heal')) pings.push(`<@&${ROLE_HEAL_ID}>`);
  if (rolesNeeded.has('dps'))  pings.push(`<@&${ROLE_DPS_ID}>`);
  return `${pings.join(' ')} — Un groupe se forme pour **${dungeonLabel} +${level}** !`;
}

// ──────────────────────────────────────────
// Client Discord
// ──────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', async () => {
  console.log(`🤖 KeyBot connecté en tant que ${client.user.tag}`);
  await setupLFGChannel(client);
});

client.on('interactionCreate', async interaction => {
  const userId = interaction.user.id;

  // ── Bouton permanent "Créer un groupe" ──
  if (interaction.isButton() && interaction.customId === 'open_lfm') {
    sessions.set(userId, { dungeon: null, level: null, roles: new Set() });
    await interaction.reply({
      content: '## 🗝️ Créer un groupe Mythic+\n**Étape 1/3** — Choisis le donjon :',
      components: [buildDungeonSelect()],
      ephemeral: true
    });
    return;
  }

  // ── /lfm (commande slash, toujours disponible) ──
  if (interaction.isChatInputCommand() && interaction.commandName === 'lfm') {
    sessions.set(userId, { dungeon: null, level: null, roles: new Set() });
    await interaction.reply({
      content: '## 🗝️ Créer un groupe Mythic+\n**Étape 1/3** — Choisis le donjon :',
      components: [buildDungeonSelect()],
      ephemeral: true
    });
    return;
  }

  // ── Sélection du donjon ──
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_dungeon') {
    const session = sessions.get(userId) || { dungeon: null, level: null, roles: new Set() };
    session.dungeon = interaction.values[0];
    sessions.set(userId, session);
    const d = DUNGEONS.find(d => d.value === session.dungeon);
    await interaction.update({
      content: `## 🗝️ Créer un groupe Mythic+\n✅ Donjon : **${d?.emoji} ${d?.label}**\n**Étape 2/3** — Choisis le niveau de clé :`,
      components: [buildLevelSelect()]
    });
    return;
  }

  // ── Sélection du niveau ──
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_level') {
    const session = sessions.get(userId);
    if (!session) return;
    session.level = interaction.values[0];
    sessions.set(userId, session);
    const d = DUNGEONS.find(d => d.value === session.dungeon);
    await interaction.update({
      content: `## 🗝️ Créer un groupe Mythic+\n✅ Donjon : **${d?.emoji} ${d?.label}** — Clé **+${session.level}**\n**Étape 3/3** — Quels rôles tu cherches ?`,
      components: [buildRoleButtons(session.roles)]
    });
    return;
  }

  // ── Toggle rôles ──
  if (interaction.isButton() && ['toggle_tank','toggle_heal','toggle_dps'].includes(interaction.customId)) {
    const session = sessions.get(userId);
    if (!session) return;
    const role = interaction.customId.replace('toggle_', '');
    if (session.roles.has(role)) session.roles.delete(role);
    else session.roles.add(role);
    sessions.set(userId, session);
    const d = DUNGEONS.find(d => d.value === session.dungeon);
    await interaction.update({
      content: `## 🗝️ Créer un groupe Mythic+\n✅ Donjon : **${d?.emoji} ${d?.label}** — Clé **+${session.level}**\n**Étape 3/3** — Quels rôles tu cherches ?`,
      components: [buildRoleButtons(session.roles)]
    });
    return;
  }

  // ── Publication du groupe ──
  if (interaction.isButton() && interaction.customId === 'publish_group') {
    const session = sessions.get(userId);
    if (!session || session.roles.size === 0) return;

    const members = { tank: null, heal: null, dps: [] };
    const embed = buildGroupEmbed(session.dungeon, session.level, session.roles, members);
    const joinRow = buildJoinButtons(session.roles);
    const pingMsg = buildPingMessage(session.roles, session.dungeon, session.level);

    const msg = await interaction.channel.send({ content: pingMsg, embeds: [embed], components: [joinRow] });
    groups.set(msg.id, { dungeon: session.dungeon, level: session.level, rolesNeeded: new Set(session.roles), members, hostId: userId });
    sessions.delete(userId);

    await interaction.update({ content: '✅ **Groupe publié !**', components: [] });
    return;
  }

  // ── Rejoindre Tank ──
  if (interaction.isButton() && interaction.customId === 'join_tank') {
    const group = groups.get(interaction.message.id);
    if (!group) return;
    if (group.members.tank) { await interaction.reply({ content: '❌ Le slot Tank est déjà pris !', ephemeral: true }); return; }
    group.members.tank = userId;
    await updateGroupMessage(interaction, group);
    return;
  }

  // ── Rejoindre Heal ──
  if (interaction.isButton() && interaction.customId === 'join_heal') {
    const group = groups.get(interaction.message.id);
    if (!group) return;
    if (group.members.heal) { await interaction.reply({ content: '❌ Le slot Heal est déjà pris !', ephemeral: true }); return; }
    group.members.heal = userId;
    await updateGroupMessage(interaction, group);
    return;
  }

  // ── Rejoindre DPS ──
  if (interaction.isButton() && interaction.customId === 'join_dps') {
    const group = groups.get(interaction.message.id);
    if (!group) return;
    if (group.members.dps.length >= 3) { await interaction.reply({ content: '❌ Les slots DPS sont tous pris !', ephemeral: true }); return; }
    if (group.members.dps.includes(userId)) { await interaction.reply({ content: '❌ Tu es déjà inscrit !', ephemeral: true }); return; }
    group.members.dps.push(userId);
    await updateGroupMessage(interaction, group);
    return;
  }

  // ── Quitter ──
  if (interaction.isButton() && interaction.customId === 'leave_group') {
    const group = groups.get(interaction.message.id);
    if (!group) return;
    if (group.members.tank === userId) group.members.tank = null;
    else if (group.members.heal === userId) group.members.heal = null;
    else group.members.dps = group.members.dps.filter(id => id !== userId);
    await updateGroupMessage(interaction, group);
    return;
  }
});

async function updateGroupMessage(interaction, group) {
  const embed = buildGroupEmbed(group.dungeon, group.level, group.rolesNeeded, group.members);
  const totalNeeded =
    (group.rolesNeeded.has('tank') ? 1 : 0) +
    (group.rolesNeeded.has('heal') ? 1 : 0) +
    (group.rolesNeeded.has('dps') ? 3 : 0);
  const totalFilled =
    (group.members.tank ? 1 : 0) +
    (group.members.heal ? 1 : 0) +
    group.members.dps.length;
  const isFull = totalFilled >= totalNeeded;

  if (isFull) {
    await interaction.update({ embeds: [embed], components: [] });
    await interaction.followUp({ content: `🎉 **Groupe complet !** <@${group.hostId}> ton groupe est prêt, bonne run !`, ephemeral: false });
  } else {
    await interaction.update({ embeds: [embed], components: [buildJoinButtons(group.rolesNeeded)] });
  }
}

// ──────────────────────────────────────────
// Démarrage
// ──────────────────────────────────────────
registerCommands().then(() => client.login(TOKEN));
