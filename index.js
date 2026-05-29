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
const LFG_CHANNEL_ID   = '1509506151866433686';
const FORUM_CHANNEL_ID = '1508028447845257357'; // ⚠️ Remplace par l'ID du forum "propose-ta-clé"
const CATEGORY_ID      = '1508028184967512126';
const ROLE_TANK_ID     = '1415752673910718634';
const ROLE_HEAL_ID     = '1415752675609284629';
const ROLE_DPS_ID      = '1415752676930486347';
const ROLE_MODO_ID     = '1401884404779061369';
const ROLE_GERANT_ID   = '1508058886794383471';

const GROUP_TIMEOUT_MS = 30 * 60 * 1000;

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

const sessions     = new Map(); // userId → session
const groups       = new Map(); // threadId → groupe
const privateChans = new Map(); // textChannelId → { voiceChannelId, hostId, closeMsgId }

// ──────────────────────────────────────────
// Enregistrement /lfm
// ──────────────────────────────────────────
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), {
    body: [new SlashCommandBuilder().setName('lfm').setDescription('Créer un groupe Mythic+ en quelques clics').toJSON()]
  });
  console.log('✅ Commande /lfm enregistrée');
}

// ──────────────────────────────────────────
// Message permanent LFG
// ──────────────────────────────────────────
async function setupLFGChannel(client) {
  const channel = await client.channels.fetch(LFG_CHANNEL_ID).catch(() => null);
  if (!channel) { console.log('⚠️ Channel LFG introuvable'); return; }
  const messages = await channel.messages.fetch({ limit: 20 });
  for (const msg of messages.filter(m => m.author.id === client.user.id && m.components.length > 0).values())
    await msg.delete().catch(() => {});
  await channel.send({
    embeds: [new EmbedBuilder()
      .setTitle('🗝️ Groupe Mythic+ — Saison 1 Midnight')
      .setDescription('Clique sur le bouton ci-dessous pour créer un groupe en quelques clics.\nChoisis ton donjon, le niveau de clé et les rôles recherchés.')
      .setColor(0x5865f2)
      .setFooter({ text: 'Le menu de création est visible uniquement par toi.' })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('open_lfm').setLabel('🗝️ Créer un groupe').setStyle(ButtonStyle.Primary)
    )]
  });
  console.log('✅ Message permanent LFG envoyé');
}

// ──────────────────────────────────────────
// Helpers UI
// ──────────────────────────────────────────
const dungeonSelect = () => new ActionRowBuilder().addComponents(
  new StringSelectMenuBuilder().setCustomId('select_dungeon').setPlaceholder('🗺️ Choisir un donjon...')
    .addOptions(DUNGEONS.map(d => ({ label: d.label, value: d.value, emoji: d.emoji })))
);
const levelSelect = () => new ActionRowBuilder().addComponents(
  new StringSelectMenuBuilder().setCustomId('select_level').setPlaceholder('🔑 Choisir le niveau de clé...')
    .addOptions([2,3,4,5,6,7,8,9,10,11,12,13,14,15,17,20].map(l => ({ label: `+${l}`, value: String(l) })))
);
const roleToggleButtons = (sel = new Set()) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('toggle_tank').setLabel('🛡️ Tank').setStyle(sel.has('tank') ? ButtonStyle.Primary : ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId('toggle_heal').setLabel('💚 Heal').setStyle(sel.has('heal') ? ButtonStyle.Success : ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId('toggle_dps').setLabel('⚔️ DPS').setStyle(sel.has('dps') ? ButtonStyle.Danger : ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId('publish_group').setLabel('Publier le groupe ➜').setStyle(ButtonStyle.Primary).setDisabled(sel.size === 0)
);
const hostRoleButtons = (rolesNeeded) => {
  const row = new ActionRowBuilder();
  if (rolesNeeded.has('tank')) row.addComponents(new ButtonBuilder().setCustomId('host_tank').setLabel('🛡️ Tank').setStyle(ButtonStyle.Primary));
  if (rolesNeeded.has('heal')) row.addComponents(new ButtonBuilder().setCustomId('host_heal').setLabel('💚 Heal').setStyle(ButtonStyle.Success));
  if (rolesNeeded.has('dps'))  row.addComponents(new ButtonBuilder().setCustomId('host_dps').setLabel('⚔️ DPS').setStyle(ButtonStyle.Danger));
  row.addComponents(new ButtonBuilder().setCustomId('host_none').setLabel('Je ne joue pas').setStyle(ButtonStyle.Secondary));
  return row;
};
const joinButtons = (rolesNeeded) => {
  const row = new ActionRowBuilder();
  if (rolesNeeded.has('tank')) row.addComponents(new ButtonBuilder().setCustomId('join_tank').setLabel('🛡️ Tank').setStyle(ButtonStyle.Primary));
  if (rolesNeeded.has('heal')) row.addComponents(new ButtonBuilder().setCustomId('join_heal').setLabel('💚 Heal').setStyle(ButtonStyle.Success));
  if (rolesNeeded.has('dps'))  row.addComponents(new ButtonBuilder().setCustomId('join_dps').setLabel('⚔️ DPS').setStyle(ButtonStyle.Danger));
  row.addComponents(new ButtonBuilder().setCustomId('leave_group').setLabel('Quitter').setStyle(ButtonStyle.Secondary));
  return row;
};

// Bouton rouge de clôture — épinglé en bas du canal privé
const closeButton = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('close_channel').setLabel('🔴 Clôturer la clé et fermer le canal').setStyle(ButtonStyle.Danger)
);

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
  const total  = (rolesNeeded.has('tank')?1:0)+(rolesNeeded.has('heal')?1:0)+(rolesNeeded.has('dps')?3:0);
  const filled = (members.tank?1:0)+(members.heal?1:0)+members.dps.length;
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

function dungeonName(value) { return DUNGEONS.find(d => d.value === value)?.label || value; }
function randomEncouragement() { return ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)]; }

// ──────────────────────────────────────────
// Création canaux privés juste sous le forum
// ──────────────────────────────────────────
async function createPrivateChannels(guild, members, dungeon, level, hostId) {
  const memberIds = [members.tank, members.heal, ...members.dps].filter(Boolean);
  const safeName  = dungeonName(dungeon).toLowerCase().replace(/[^a-z0-9]/gi, '-').replace(/-+/g,'-').substring(0,20);
  const name      = `${safeName}-${level}`;

  // Récupère la position du forum pour placer les canaux juste après
  const forumChannel = await guild.channels.fetch(FORUM_CHANNEL_ID).catch(() => null);
  const forumPosition = forumChannel ? forumChannel.position + 1 : undefined;

  const perms = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
    // Modérateurs et Gérants : accès lecture/modération, sans mention donc sans notification
    { id: ROLE_MODO_ID,   allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.Connect], deny: [PermissionFlagsBits.MentionEveryone] },
    { id: ROLE_GERANT_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.Connect], deny: [PermissionFlagsBits.MentionEveryone] },
    ...memberIds.map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] }))
  ];

  const textChannel = await guild.channels.create({
    name: `🗝️-${name}`,
    type: ChannelType.GuildText,
    parent: CATEGORY_ID,
    permissionOverwrites: perms,
    position: forumPosition,
  });

  const voiceChannel = await guild.channels.create({
    name: `🎙️ ${dungeonName(dungeon)} +${level}`,
    type: ChannelType.GuildVoice,
    parent: CATEGORY_ID,
    permissionOverwrites: perms,
    position: forumPosition ? forumPosition + 1 : undefined,
  });

  const mentions = memberIds.map(id => `<@${id}>`).join(' ');

  // Message de bienvenue
  await textChannel.send({
    content: `${mentions}\n🎉 **Votre groupe est prêt !** Rejoignez le vocal <#${voiceChannel.id}>.\n\n${randomEncouragement()}`
  });

  // Message avec bouton rouge épinglé
  const closeMsg = await textChannel.send({
    content: `> <@${hostId}> — Quand la run est terminée, clique sur le bouton ci-dessous pour clôturer le canal.`,
    components: [closeButton()]
  });

  // Épingler le message de clôture
  await closeMsg.pin().catch(() => {});

  // Stocker les infos du canal privé
  privateChans.set(textChannel.id, {
    voiceChannelId: voiceChannel.id,
    hostId,
    closeMsgId: closeMsg.id,
  });

  return { textChannel, voiceChannel };
}

// ──────────────────────────────────────────
// Publication dans le forum
// ──────────────────────────────────────────
async function publishGroup(interaction, session) {
  const { dungeon, level, roles, hostRole } = session;
  const guild = interaction.guild;

  const members = { tank: null, heal: null, dps: [] };
  if (hostRole === 'tank') members.tank = interaction.user.id;
  else if (hostRole === 'heal') members.heal = interaction.user.id;
  else if (hostRole === 'dps') members.dps.push(interaction.user.id);

  const d = DUNGEONS.find(x => x.value === dungeon);
  const forumChannel = await guild.channels.fetch(FORUM_CHANNEL_ID).catch(() => null);
  if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
    await interaction.editReply({ content: '❌ Channel forum introuvable. Vérifie FORUM_CHANNEL_ID.', components: [] });
    return;
  }

  const thread = await forumChannel.threads.create({
    name: `${d?.emoji} ${d?.label} — +${level}`,
    message: {
      content: pingLine(roles, dungeon, level),
      embeds: [groupEmbed(dungeon, level, roles, members)],
      components: [joinButtons(roles)]
    },
  });

  // Modos et Gérants : accès au thread mais sans notification
  await thread.members.add(guild.roles.cache.get(ROLE_MODO_ID)?.id).catch(() => {});
  await thread.setAutoArchiveDuration(60).catch(() => {});

  // Créer les canaux privés dès la publication
  let textChannel = null, voiceChannel = null;
  try {
    const priv = await createPrivateChannels(guild, members, dungeon, level, interaction.user.id);
    textChannel  = priv.textChannel;
    voiceChannel = priv.voiceChannel;
  } catch (e) { console.error('Erreur canaux privés:', e); }

  groups.set(thread.id, {
    dungeon, level,
    rolesNeeded: new Set(roles),
    members,
    hostId: interaction.user.id,
    threadId: thread.id,
    guildId: guild.id,
    complete: false,
    textChannelId: textChannel?.id || null,
    voiceChannelId: voiceChannel?.id || null,
  });

  const privMsg = textChannel && voiceChannel
    ? `\n🔒 Votre espace privé : <#${textChannel.id}> et <#${voiceChannel.id}>`
    : '';
  await interaction.editReply({ content: `✅ **Groupe publié !** → <#${thread.id}>${privMsg}`, components: [] });

  // Timer 30 min
  setTimeout(async () => {
    const group = groups.get(thread.id);
    if (!group || group.complete) return;
    const total  = (group.rolesNeeded.has('tank')?1:0)+(group.rolesNeeded.has('heal')?1:0)+(group.rolesNeeded.has('dps')?3:0);
    const filled = (group.members.tank?1:0)+(group.members.heal?1:0)+group.members.dps.length;
    if (filled < total) {
      const t = await guild.channels.fetch(thread.id).catch(() => null);
      if (t) {
        await t.send({ content: `😔 **${dungeonName(dungeon)} +${level}** — Dommage, vous avez raté une occasion de vous amuser ensemble. À la prochaine !` });
        setTimeout(() => t.delete().catch(() => {}), 10000);
      }
    }
    groups.delete(thread.id);
  }, GROUP_TIMEOUT_MS);
}

// ──────────────────────────────────────────
// Client
// ──────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers]
});

client.once('clientReady', async () => {
  console.log(`🤖 KeyBot connecté en tant que ${client.user.tag}`);
  await setupLFGChannel(client);
});

// Suppression vocal quand vide
client.on('voiceStateUpdate', async (oldState) => {
  if (!oldState.channelId) return;
  const channel = oldState.channel;
  if (channel && channel.members.size === 0) await channel.delete().catch(() => {});
});

client.on('interactionCreate', async interaction => {
  const userId = interaction.user.id;

  // ── Bouton clôture canal privé ──
  if (interaction.isButton() && interaction.customId === 'close_channel') {
    const chanData = privateChans.get(interaction.channelId);
    if (!chanData) { await interaction.reply({ content: '❌ Canal introuvable.', ephemeral: true }); return; }

    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    const isModo   = member?.roles.cache.has(ROLE_MODO_ID);
    const isGerant = member?.roles.cache.has(ROLE_GERANT_ID);
    const isHost   = chanData.hostId === userId;

    if (!isHost && !isModo && !isGerant) {
      await interaction.reply({ content: '❌ Seul le créateur du groupe, un Modérateur ou le Gérant peut clôturer ce canal.', ephemeral: true });
      return;
    }
    await interaction.reply({ content: '🔴 **Clôture du canal en cours...**' });
    const voiceChannel = await interaction.guild.channels.fetch(chanData.voiceChannelId).catch(() => null);
    if (voiceChannel) await voiceChannel.delete().catch(() => {});
    setTimeout(() => interaction.channel.delete().catch(() => {}), 2000);
    privateChans.delete(interaction.channelId);
    return;
  }

  // ── Ouvrir menu création ──
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
    await interaction.update({ content: `## 🗝️ Créer un groupe Mythic+\n✅ **${d?.emoji} ${d?.label}**\n**Étape 2/3** — Niveau de clé :`, components: [levelSelect()] });
    return;
  }

  // ── Sélection niveau ──
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_level') {
    const s = sessions.get(userId);
    if (!s) return;
    s.level = interaction.values[0];
    const d = DUNGEONS.find(x => x.value === s.dungeon);
    await interaction.update({ content: `## 🗝️ Créer un groupe Mythic+\n✅ **${d?.emoji} ${d?.label}** — Clé **+${s.level}**\n**Étape 3/3** — Rôles recherchés :`, components: [roleToggleButtons(s.roles)] });
    return;
  }

  // ── Toggle rôles ──
  if (interaction.isButton() && ['toggle_tank','toggle_heal','toggle_dps'].includes(interaction.customId)) {
    const s = sessions.get(userId);
    if (!s) return;
    const role = interaction.customId.replace('toggle_', '');
    s.roles.has(role) ? s.roles.delete(role) : s.roles.add(role);
    const d = DUNGEONS.find(x => x.value === s.dungeon);
    await interaction.update({ content: `## 🗝️ Créer un groupe Mythic+\n✅ **${d?.emoji} ${d?.label}** — Clé **+${s.level}**\n**Étape 3/3** — Rôles recherchés :`, components: [roleToggleButtons(s.roles)] });
    return;
  }

  // ── Publier → demander rôle créateur ──
  if (interaction.isButton() && interaction.customId === 'publish_group') {
    const s = sessions.get(userId);
    if (!s || s.roles.size === 0) return;
    const d = DUNGEONS.find(x => x.value === s.dungeon);
    await interaction.update({ content: `## 🗝️ Créer un groupe Mythic+\n✅ **${d?.emoji} ${d?.label}** — Clé **+${s.level}**\n**Dernière étape** — Quel rôle tu joues ?`, components: [hostRoleButtons(s.roles)] });
    return;
  }

  // ── Rôle créateur → publication ──
  if (interaction.isButton() && ['host_tank','host_heal','host_dps','host_none'].includes(interaction.customId)) {
    const s = sessions.get(userId);
    if (!s) return;
    s.hostRole = interaction.customId.replace('host_', '');
    await interaction.deferUpdate();
    await publishGroup(interaction, s);
    sessions.delete(userId);
    return;
  }

  // ── Rejoindre / quitter (dans thread forum) ──
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

  // Donner accès aux canaux privés au nouveau membre
  if (interaction.customId !== 'leave_group' && group.textChannelId) {
    const textChan  = await interaction.guild.channels.fetch(group.textChannelId).catch(() => null);
    const voiceChan = group.voiceChannelId ? await interaction.guild.channels.fetch(group.voiceChannelId).catch(() => null) : null;
    if (textChan)  await textChan.permissionOverwrites.create(userId,  { ViewChannel: true, SendMessages: true }).catch(() => {});
    if (voiceChan) await voiceChan.permissionOverwrites.create(userId, { ViewChannel: true, Connect: true, Speak: true }).catch(() => {});
  }

  const total  = (group.rolesNeeded.has('tank')?1:0)+(group.rolesNeeded.has('heal')?1:0)+(group.rolesNeeded.has('dps')?3:0);
  const filled = (group.members.tank?1:0)+(group.members.heal?1:0)+group.members.dps.length;
  const embed  = groupEmbed(group.dungeon, group.level, group.rolesNeeded, group.members);
  const isFull = filled >= total;

  if (isFull) {
    group.complete = true;
    await interaction.update({ embeds: [embed], components: [] });
    await interaction.channel.send({ content: `🎉 ${randomEncouragement()}` });
    setTimeout(() => interaction.channel.delete().catch(() => {}), GROUP_TIMEOUT_MS);
  } else {
    await interaction.update({ embeds: [embed], components: [joinButtons(group.rolesNeeded)] });
  }
});

registerCommands().then(() => client.login(TOKEN));
