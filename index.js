const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, ChannelType, PermissionFlagsBits
} = require('discord.js');

const TOKEN     = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// ──────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────
const LFG_CHANNEL_ID  = '1509506151866433686'; // channel avec le bouton permanent
const FORUM_CHANNEL_ID = '1508028447845257357'; // channel forum "propose-ta-clé" — remplace par l'ID du forum si différent
const CATEGORY_ID     = '1508028184967512126'; // catégorie sous laquelle créer les canaux privés
const ROLE_TANK_ID    = '1415752673910718634';
const ROLE_HEAL_ID    = '1415752675609284629';
const ROLE_DPS_ID     = '1415752676930486347';

const GROUP_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// ──────────────────────────────────────────
// Donjons — Saison 1 Midnight
// ──────────────────────────────────────────
const DUNGEONS = [
  { label: 'Terrasse des Magistères', value: 'magisters',  emoji: '🌙' },
  { label: 'Flèche de Coursevent',    value: 'coursevent', emoji: '💨' },
  { label: 'Cavernes de Maisara',     value: 'maisara',    emoji: '🌑' },
  { label: 'Point-Nexus Xenas',       value: 'xenas',      emoji: '☀️' },
  { label: 'Orée-du-Ciel',           value: 'oree',       emoji: '🪶' },
  { label: 'Siège du Triumvirat',     value: 'triumvirat', emoji: '⚔️' },
  { label: "Académie d'Algeth'ar",    value: 'algethar',   emoji: '📚' },
  { label: 'Fosse de Saron',          value: 'saron',      emoji: '❄️' },
];

const ENCOURAGEMENTS = [
  "Merci de faire vivre la communauté ! Amusez-vous, c'est la priorité. 🎉",
  "Groupe complet ! Que l'aventure commence. Amusez-vous bien ! ⚔️",
  "5/5 ! La communauté est vivante grâce à vous. Bonne run ! 🗝️",
];

const sessions = new Map(); // userId → session en cours
const groups   = new Map(); // threadId → données du groupe

// ──────────────────────────────────────────
// Enregistrement commande /lfm
// ──────────────────────────────────────────
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), {
    body: [new SlashCommandBuilder().setName('lfm').setDescription('Créer un groupe Mythic+ en quelques clics').toJSON()]
  });
  console.log('✅ Commande /lfm enregistrée');
}

// ──────────────────────────────────────────
// Message permanent dans le channel LFG
// ──────────────────────────────────────────
async function setupLFGChannel(client) {
  const channel = await client.channels.fetch(LFG_CHANNEL_ID).catch(() => null);
  if (!channel) { console.log('⚠️ Channel LFG introuvable'); return; }

  const messages = await channel.messages.fetch({ limit: 20 });
  const botMsgs = messages.filter(m => m.author.id === client.user.id && m.components.length > 0);
  for (const msg of botMsgs.values()) await msg.delete().catch(() => {});

  const embed = new EmbedBuilder()
    .setTitle('🗝️ Groupe Mythic+ — Saison 1 Midnight')
    .setDescription('Clique sur le bouton ci-dessous pour créer un groupe en quelques clics.\nChoisis ton donjon, le niveau de clé et les rôles recherchés.')
    .setColor(0x5865f2)
    .setFooter({ text: 'Le menu de création est visible uniquement par toi.' });

  await channel.send({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('open_lfm').setLabel('🗝️ Créer un groupe').setStyle(ButtonStyle.Primary)
    )]
  });
  console.log('✅ Message permanent LFG envoyé');
}

// ──────────────────────────────────────────
// Helpers UI
// ──────────────────────────────────────────
function dungeonSelect() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('select_dungeon').setPlaceholder('🗺️ Choisir un donjon...')
      .addOptions(DUNGEONS.map(d => ({ label: d.label, value: d.value, emoji: d.emoji })))
  );
}

function levelSelect() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('select_level').setPlaceholder('🔑 Choisir le niveau de clé...')
      .addOptions([2,3,4,5,6,7,8,9,10,11,12,13,14,15,17,20].map(l => ({ label: `+${l}`, value: String(l) })))
  );
}

function roleToggleButtons(sel = new Set()) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('toggle_tank').setLabel('🛡️ Tank').setStyle(sel.has('tank') ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('toggle_heal').setLabel('💚 Heal').setStyle(sel.has('heal') ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('toggle_dps').setLabel('⚔️ DPS').setStyle(sel.has('dps') ? ButtonStyle.Danger : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('publish_group').setLabel('Publier le groupe ➜').setStyle(ButtonStyle.Primary).setDisabled(sel.size === 0)
  );
}

function hostRoleButtons(rolesNeeded) {
  const row = new ActionRowBuilder();
  if (rolesNeeded.has('tank')) row.addComponents(new ButtonBuilder().setCustomId('host_tank').setLabel('🛡️ Tank').setStyle(ButtonStyle.Primary));
  if (rolesNeeded.has('heal')) row.addComponents(new ButtonBuilder().setCustomId('host_heal').setLabel('💚 Heal').setStyle(ButtonStyle.Success));
  if (rolesNeeded.has('dps'))  row.addComponents(new ButtonBuilder().setCustomId('host_dps').setLabel('⚔️ DPS').setStyle(ButtonStyle.Danger));
  row.addComponents(new ButtonBuilder().setCustomId('host_none').setLabel('Je ne joue pas').setStyle(ButtonStyle.Secondary));
  return row;
}

function joinButtons(rolesNeeded) {
  const row = new ActionRowBuilder();
  if (rolesNeeded.has('tank')) row.addComponents(new ButtonBuilder().setCustomId('join_tank').setLabel('🛡️ Tank').setStyle(ButtonStyle.Primary));
  if (rolesNeeded.has('heal')) row.addComponents(new ButtonBuilder().setCustomId('join_heal').setLabel('💚 Heal').setStyle(ButtonStyle.Success));
  if (rolesNeeded.has('dps'))  row.addComponents(new ButtonBuilder().setCustomId('join_dps').setLabel('⚔️ DPS').setStyle(ButtonStyle.Danger));
  row.addComponents(new ButtonBuilder().setCustomId('leave_group').setLabel('Quitter').setStyle(ButtonStyle.Secondary));
  return row;
}

function groupEmbed(dungeon, level, rolesNeeded, members) {
  const d = DUNGEONS.find(x => x.value === dungeon);
  const lines = [];
  if (rolesNeeded.has('tank')) lines.push(`🛡️ **Tank** — ${members.tank ? `<@${members.tank}>` : '*En attente...*'}`);
  if (rolesNeeded.has('heal')) lines.push(`💚 **Heal** — ${members.heal ? `<@${members.heal}>` : '*En attente...*'}`);
  if (rolesNeeded.has('dps')) {
    const filled = members.dps.map(id => `<@${id}>`);
    const empty  = Array(3 - members.dps.length).fill('*En attente...*');
    [...filled, ...empty].forEach(x => lines.push(`⚔️ **DPS** — ${x}`));
  }
  const total  = (rolesNeeded.has('tank')?1:0) + (rolesNeeded.has('heal')?1:0) + (rolesNeeded.has('dps')?3:0);
  const filled = (members.tank?1:0) + (members.heal?1:0) + members.dps.length;
  return new EmbedBuilder()
    .setTitle(`${d?.emoji} ${d?.label} — Clé +${level}`)
    .setDescription(lines.join('\n'))
    .setColor(filled >= total ? 0x57ab5a : 0x5865f2)
    .setFooter({ text: filled >= total ? '✅ Groupe complet !' : `${filled}/${total} joueurs • Saison 1 Midnight` })
    .setTimestamp();
}

function pingLine(rolesNeeded, dungeon, level) {
  const d = DUNGEONS.find(x => x.value === dungeon);
  const pings = [];
  if (rolesNeeded.has('tank')) pings.push(`<@&${ROLE_TANK_ID}>`);
  if (rolesNeeded.has('heal')) pings.push(`<@&${ROLE_HEAL_ID}>`);
  if (rolesNeeded.has('dps'))  pings.push(`<@&${ROLE_DPS_ID}>`);
  return `${pings.join(' ')} — Un groupe se forme pour **${d?.label} +${level}** !`;
}

function dungeonName(value) {
  return DUNGEONS.find(d => d.value === value)?.label || value;
}

function randomEncouragement() {
  return ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)];
}

// ──────────────────────────────────────────
// Création des canaux privés (texte + vocal)
// ──────────────────────────────────────────
async function createPrivateChannels(guild, members, dungeon, level) {
  const memberIds = [
    members.tank,
    members.heal,
    ...members.dps
  ].filter(Boolean);

  const name = `${dungeonName(dungeon).toLowerCase().replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-')}-${level}`;

  const permissionOverwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    ...memberIds.map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] }))
  ];

  // Canal texte privé
  const textChannel = await guild.channels.create({
    name: `🗝️-${name}`,
    type: ChannelType.GuildText,
    parent: CATEGORY_ID,
    permissionOverwrites,
  });

  // Canal vocal privé
  const voiceChannel = await guild.channels.create({
    name: `🎙️ ${dungeonName(dungeon)} +${level}`,
    type: ChannelType.GuildVoice,
    parent: CATEGORY_ID,
    permissionOverwrites,
  });

  // Message de bienvenue dans le texte
  const mentions = memberIds.map(id => `<@${id}>`).join(' ');
  await textChannel.send({
    content: `${mentions}\n🎉 **Votre groupe est prêt !** Rendez-vous dans le vocal <#${voiceChannel.id}> pour commencer la run.\n\n${randomEncouragement()}`
  });

  // Surveillance du vocal → suppression quand vide
  return { textChannel, voiceChannel };
}

// ──────────────────────────────────────────
// Publication du groupe dans le forum
// ──────────────────────────────────────────
async function publishGroup(interaction, session) {
  const { dungeon, level, roles, hostRole } = session;
  const guild = interaction.guild;

  const members = { tank: null, heal: null, dps: [] };
  if (hostRole === 'tank') members.tank = interaction.user.id;
  else if (hostRole === 'heal') members.heal = interaction.user.id;
  else if (hostRole === 'dps') members.dps.push(interaction.user.id);

  const d = DUNGEONS.find(x => x.value === dungeon);
  const threadName = `${d?.emoji} ${d?.label} — +${level}`;
  const ping = pingLine(roles, dungeon, level);
  const embed = groupEmbed(dungeon, level, roles, members);

  // Créer le post dans le forum
  const forumChannel = await guild.channels.fetch(FORUM_CHANNEL_ID).catch(() => null);
  if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
    await interaction.editReply({ content: '❌ Le channel forum est introuvable ou n\'est pas un forum. Vérifie FORUM_CHANNEL_ID dans le code.', components: [] });
    return;
  }

  const thread = await forumChannel.threads.create({
    name: threadName,
    message: { content: ping, embeds: [embed], components: [joinButtons(roles)] },
  });

  groups.set(thread.id, {
    dungeon, level,
    rolesNeeded: new Set(roles),
    members,
    hostId: interaction.user.id,
    threadId: thread.id,
    guildId: guild.id,
    complete: false,
  });

  await interaction.editReply({ content: `✅ **Groupe publié !** → <#${thread.id}>`, components: [] });

  // Timer 30 minutes → suppression si pas complet
  setTimeout(async () => {
    const group = groups.get(thread.id);
    if (!group || group.complete) return;

    const total  = (group.rolesNeeded.has('tank')?1:0) + (group.rolesNeeded.has('heal')?1:0) + (group.rolesNeeded.has('dps')?3:0);
    const filled = (group.members.tank?1:0) + (group.members.heal?1:0) + group.members.dps.length;

    if (filled < total) {
      try {
        const t = await guild.channels.fetch(thread.id).catch(() => null);
        if (t) {
          await t.send({ content: `😔 **${dungeonName(dungeon)} +${level}** — Dommage, vous avez raté une occasion de vous amuser ensemble. À la prochaine !` });
          setTimeout(() => t.delete().catch(() => {}), 10000);
        }
      } catch (e) { console.error(e); }
    }
    groups.delete(thread.id);
  }, GROUP_TIMEOUT_MS);
}

// ──────────────────────────────────────────
// Client Discord
// ──────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ]
});

client.once('clientReady', async () => {
  console.log(`🤖 KeyBot connecté en tant que ${client.user.tag}`);
  await setupLFGChannel(client);
});

// Suppression du vocal quand il est vide
client.on('voiceStateUpdate', async (oldState, newState) => {
  if (!oldState.channelId) return;
  const channel = oldState.channel;
  if (!channel) return;
  if (channel.members.size === 0) {
    await channel.delete().catch(() => {});
  }
});

client.on('interactionCreate', async interaction => {
  const userId = interaction.user.id;

  // ── Ouvrir le menu ──
  const openMenu = async () => {
    sessions.set(userId, { dungeon: null, level: null, roles: new Set(), hostRole: null });
    await interaction.reply({
      content: '## 🗝️ Créer un groupe Mythic+\n**Étape 1/3** — Choisis le donjon :',
      components: [dungeonSelect()],
      ephemeral: true
    });
  };

  if (interaction.isButton() && interaction.customId === 'open_lfm') { await openMenu(); return; }
  if (interaction.isChatInputCommand() && interaction.commandName === 'lfm') { await openMenu(); return; }

  // ── Sélection donjon ──
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_dungeon') {
    const s = sessions.get(userId) || { dungeon: null, level: null, roles: new Set(), hostRole: null };
    s.dungeon = interaction.values[0];
    sessions.set(userId, s);
    const d = DUNGEONS.find(x => x.value === s.dungeon);
    await interaction.update({
      content: `## 🗝️ Créer un groupe Mythic+\n✅ **${d?.emoji} ${d?.label}**\n**Étape 2/3** — Niveau de clé :`,
      components: [levelSelect()]
    });
    return;
  }

  // ── Sélection niveau ──
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_level') {
    const s = sessions.get(userId);
    if (!s) return;
    s.level = interaction.values[0];
    sessions.set(userId, s);
    const d = DUNGEONS.find(x => x.value === s.dungeon);
    await interaction.update({
      content: `## 🗝️ Créer un groupe Mythic+\n✅ **${d?.emoji} ${d?.label}** — Clé **+${s.level}**\n**Étape 3/3** — Rôles recherchés :`,
      components: [roleToggleButtons(s.roles)]
    });
    return;
  }

  // ── Toggle rôles ──
  if (interaction.isButton() && ['toggle_tank','toggle_heal','toggle_dps'].includes(interaction.customId)) {
    const s = sessions.get(userId);
    if (!s) return;
    const role = interaction.customId.replace('toggle_', '');
    s.roles.has(role) ? s.roles.delete(role) : s.roles.add(role);
    sessions.set(userId, s);
    const d = DUNGEONS.find(x => x.value === s.dungeon);
    await interaction.update({
      content: `## 🗝️ Créer un groupe Mythic+\n✅ **${d?.emoji} ${d?.label}** — Clé **+${s.level}**\n**Étape 3/3** — Rôles recherchés :`,
      components: [roleToggleButtons(s.roles)]
    });
    return;
  }

  // ── Publier → demander rôle du créateur ──
  if (interaction.isButton() && interaction.customId === 'publish_group') {
    const s = sessions.get(userId);
    if (!s || s.roles.size === 0) return;
    const d = DUNGEONS.find(x => x.value === s.dungeon);
    await interaction.update({
      content: `## 🗝️ Créer un groupe Mythic+\n✅ **${d?.emoji} ${d?.label}** — Clé **+${s.level}**\n**Dernière étape** — Quel rôle tu joues ?`,
      components: [hostRoleButtons(s.roles)]
    });
    return;
  }

  // ── Rôle du créateur → publication ──
  if (interaction.isButton() && ['host_tank','host_heal','host_dps','host_none'].includes(interaction.customId)) {
    const s = sessions.get(userId);
    if (!s) return;
    s.hostRole = interaction.customId.replace('host_', '');
    sessions.set(userId, s);
    await interaction.deferUpdate();
    await publishGroup(interaction, s);
    sessions.delete(userId);
    return;
  }

  // ── Rejoindre / quitter (dans le thread forum) ──
  if (!interaction.isButton()) return;
  const group = groups.get(interaction.channelId);
  if (!group) return;

  if (interaction.customId === 'join_tank') {
    if (group.members.tank) { await interaction.reply({ content: '❌ Le slot Tank est déjà pris !', ephemeral: true }); return; }
    group.members.tank = userId;
  } else if (interaction.customId === 'join_heal') {
    if (group.members.heal) { await interaction.reply({ content: '❌ Le slot Heal est déjà pris !', ephemeral: true }); return; }
    group.members.heal = userId;
  } else if (interaction.customId === 'join_dps') {
    if (group.members.dps.length >= 3) { await interaction.reply({ content: '❌ Les slots DPS sont tous pris !', ephemeral: true }); return; }
    if (group.members.dps.includes(userId)) { await interaction.reply({ content: '❌ Tu es déjà inscrit !', ephemeral: true }); return; }
    group.members.dps.push(userId);
  } else if (interaction.customId === 'leave_group') {
    if (group.members.tank === userId) group.members.tank = null;
    else if (group.members.heal === userId) group.members.heal = null;
    else group.members.dps = group.members.dps.filter(id => id !== userId);
  } else return;

  const total  = (group.rolesNeeded.has('tank')?1:0) + (group.rolesNeeded.has('heal')?1:0) + (group.rolesNeeded.has('dps')?3:0);
  const filled = (group.members.tank?1:0) + (group.members.heal?1:0) + group.members.dps.length;
  const embed  = groupEmbed(group.dungeon, group.level, group.rolesNeeded, group.members);
  const isFull = filled >= total;

  if (isFull) {
    group.complete = true;
    await interaction.update({ embeds: [embed], components: [] });

    // Message d'encouragement dans le thread
    await interaction.channel.send({ content: `🎉 ${randomEncouragement()}` });

    // Création des canaux privés
    try {
      const { textChannel, voiceChannel } = await createPrivateChannels(
        interaction.guild, group.members, group.dungeon, group.level
      );
      await interaction.channel.send({ content: `🔒 Votre espace privé est prêt : <#${textChannel.id}> et <#${voiceChannel.id}>` });
    } catch (e) {
      console.error('Erreur création canaux privés:', e);
    }

    // Suppression du thread forum après 30 min
    setTimeout(() => interaction.channel.delete().catch(() => {}), GROUP_TIMEOUT_MS);

  } else {
    await interaction.update({ embeds: [embed], components: [joinButtons(group.rolesNeeded)] });
  }
});

registerCommands().then(() => client.login(TOKEN));
