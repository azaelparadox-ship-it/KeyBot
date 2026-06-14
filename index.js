const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, ChannelType, PermissionFlagsBits
} = require('discord.js');

const TOKEN     = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const LFG_CHANNEL_ID   = '1509506151866433686';
const FORUM_CHANNEL_ID = '1508028447845257357';
const CATEGORY_ID      = '1508028184967512126';
const ROLE_TANK_ID     = '1415752673910718634';
const ROLE_HEAL_ID     = '1415752675609284629';
const ROLE_DPS_ID      = '1415752676930486347';
const ROLE_MODO_ID     = '1401884404779061369';
const ROLE_GERANT_ID   = '1508058886794383471';
const GROUP_TIMEOUT_MS = 60 * 60 * 1000;

const DUNGEONS = [
  { label: 'Terrasse des Magisteres', value: 'magisters',  emoji: '🌙' },
  { label: 'Fleche de Coursevent',    value: 'coursevent', emoji: '💨' },
  { label: 'Cavernes de Maisara',     value: 'maisara',    emoji: '🌑' },
  { label: 'Point-Nexus Xenas',       value: 'xenas',      emoji: '☀️' },
  { label: 'Oree-du-Ciel',           value: 'oree',       emoji: '🪶' },
  { label: 'Siege du Triumvirat',     value: 'triumvirat', emoji: '⚔️' },
  { label: "Academie d'Algethar",     value: 'algethar',   emoji: '📚' },
  { label: 'Fosse de Saron',          value: 'saron',      emoji: '❄️' },
];

const KEY_LEVELS = [2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30];

const ENCOURAGEMENTS = [
  "Merci de faire vivre la communaute ! Amusez-vous, c'est la priorite.",
  "Groupe complet ! Que l'aventure commence. Amusez-vous bien !",
  "5/5 ! La communaute est vivante grace a vous. Bonne run !",
];

const sessions     = new Map();
const groups       = new Map();
const privateChans = new Map();

// -- Commande /lfm --
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), {
    body: [new SlashCommandBuilder().setName('lfm').setDescription('Creer un groupe Mythic+ en quelques clics').toJSON()]
  });
  console.log('Commande /lfm enregistree');
}

// -- Message permanent LFG --
async function setupLFGChannel(client) {
  const channel = await client.channels.fetch(LFG_CHANNEL_ID).catch(() => null);
  if (!channel) { console.log('Channel LFG introuvable'); return; }
  const messages = await channel.messages.fetch({ limit: 20 });
  for (const msg of messages.filter(m => m.author.id === client.user.id && m.components.length > 0).values())
    await msg.delete().catch(() => {});
  await channel.send({
    embeds: [new EmbedBuilder()
      .setTitle('Groupe Mythic+ - Saison 1 Midnight')
      .setDescription('Clique sur le bouton ci-dessous pour creer un groupe en quelques clics.')
      .setColor(0x5865f2)
      .setFooter({ text: 'Le menu de creation est visible uniquement par toi.' })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('open_lfm').setLabel('Creer un groupe').setStyle(ButtonStyle.Primary)
    )]
  });
  console.log('Message permanent LFG envoye');
}

// -- Composants UI --
const dungeonSelect = () => new ActionRowBuilder().addComponents(
  new StringSelectMenuBuilder().setCustomId('select_dungeon').setPlaceholder('Choisir un donjon...')
    .addOptions(DUNGEONS.map(d => ({ label: d.label, value: d.value, emoji: d.emoji })))
);

const levelSelectRows = () => {
  const rows = [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('select_level')
        .setPlaceholder('Choisir le niveau (+2 a +26)...')
        .addOptions(KEY_LEVELS.slice(0, 25).map(l => ({ label: `+${l}`, value: String(l) })))
    )
  ];
  if (KEY_LEVELS.length > 25) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('select_level_high')
        .setPlaceholder('Ou niveau eleve (+27 a +30)...')
        .addOptions(KEY_LEVELS.slice(25).map(l => ({ label: `+${l}`, value: String(l) })))
    ));
  }
  return rows;
};

// Etape 3a : choisir les roles (tank/heal/dps)
const roleToggleButtons = (sel = new Set()) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('toggle_tank').setLabel('Tank').setStyle(sel.has('tank') ? ButtonStyle.Primary : ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId('toggle_heal').setLabel('Heal').setStyle(sel.has('heal') ? ButtonStyle.Success : ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId('toggle_dps').setLabel('DPS').setStyle(sel.has('dps') ? ButtonStyle.Danger : ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId('publish_group').setLabel('Publier le groupe').setStyle(ButtonStyle.Primary).setDisabled(sel.size === 0)
);

// Etape 3b : choisir le nombre de DPS (affiché uniquement si DPS est selectionne)
const dpsCountSelect = () => new ActionRowBuilder().addComponents(
  new StringSelectMenuBuilder().setCustomId('select_dps_count').setPlaceholder('Combien de DPS tu cherches ?')
    .addOptions([
      { label: '1 DPS', value: '1' },
      { label: '2 DPS', value: '2' },
      { label: '3 DPS', value: '3' },
    ])
);

// Tous les roles affiches pour le createur
const hostRoleButtons = () => {
  const row = new ActionRowBuilder();
  row.addComponents(new ButtonBuilder().setCustomId('host_tank').setLabel('Tank').setStyle(ButtonStyle.Primary));
  row.addComponents(new ButtonBuilder().setCustomId('host_heal').setLabel('Heal').setStyle(ButtonStyle.Success));
  row.addComponents(new ButtonBuilder().setCustomId('host_dps').setLabel('DPS').setStyle(ButtonStyle.Danger));
  row.addComponents(new ButtonBuilder().setCustomId('host_none').setLabel('Je ne joue pas').setStyle(ButtonStyle.Secondary));
  return row;
};

const joinButtons = (rolesNeeded) => {
  const row = new ActionRowBuilder();
  if (rolesNeeded.has('tank')) row.addComponents(new ButtonBuilder().setCustomId('join_tank').setLabel('Tank').setStyle(ButtonStyle.Primary));
  if (rolesNeeded.has('heal')) row.addComponents(new ButtonBuilder().setCustomId('join_heal').setLabel('Heal').setStyle(ButtonStyle.Success));
  if (rolesNeeded.has('dps'))  row.addComponents(new ButtonBuilder().setCustomId('join_dps').setLabel('DPS').setStyle(ButtonStyle.Danger));
  row.addComponents(new ButtonBuilder().setCustomId('leave_group').setLabel('Quitter').setStyle(ButtonStyle.Secondary));
  row.addComponents(new ButtonBuilder().setCustomId('close_inscriptions').setLabel('Cloturer les inscriptions').setStyle(ButtonStyle.Danger));
  return row;
};

// Boutons canal prive : bleu (recreer vocal) + rouge (cloturer texte seulement)
const privateChannelButtons = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('recreate_voice').setLabel('Recreer le salon vocal').setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId('close_voice').setLabel('Fermer le salon vocal').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId('close_channel').setLabel('Cloturer et fermer le canal texte').setStyle(ButtonStyle.Danger)
);

// -- Embed du groupe --
function groupEmbed(dungeon, level, rolesNeeded, members, hostUsername = null, dpsCount = 3) {
  const d = DUNGEONS.find(x => x.value === dungeon);
  const lines = [];
  if (hostUsername) lines.push(`Groupe cree par **${hostUsername}**\n`);

  if (rolesNeeded.has('tank') || members.tank) {
    lines.push(`Tank - ${members.tank ? `<@${members.tank}>` : 'En attente...'}`);
  }
  if (rolesNeeded.has('heal') || members.heal) {
    lines.push(`Heal - ${members.heal ? `<@${members.heal}>` : 'En attente...'}`);
  }
  if (rolesNeeded.has('dps') || members.dps.length > 0) {
    const filledDps = members.dps.map(id => `<@${id}>`);
    const slots = rolesNeeded.has('dps') ? dpsCount : members.dps.length;
    const emptyDps = Array(Math.max(0, slots - members.dps.length)).fill('En attente...');
    [...filledDps, ...emptyDps].forEach(x => lines.push(`DPS - ${x}`));
  }

  const TOTAL = (rolesNeeded.has('tank')?1:0) + (rolesNeeded.has('heal')?1:0) + (rolesNeeded.has('dps')?dpsCount:0)
    + ((!rolesNeeded.has('tank') && members.tank)?1:0)
    + ((!rolesNeeded.has('heal') && members.heal)?1:0)
    + ((!rolesNeeded.has('dps') && members.dps.length > 0)?members.dps.length:0);
  const filled = (members.tank?1:0)+(members.heal?1:0)+members.dps.length;
  return new EmbedBuilder()
    .setTitle(`${d?.label} - Cle +${level}`)
    .setDescription(lines.join('\n'))
    .setColor(filled >= TOTAL ? 0x57ab5a : 0x5865f2)
    .setFooter({ text: filled >= TOTAL ? 'Groupe complet !' : `${filled}/${TOTAL} joueurs - Saison 1 Midnight` })
    .setTimestamp();
}

// Ping uniquement les roles encore recherches (pas celui du createur)
function pingLine(rolesNeeded, hostRole, dungeon, level) {
  const d = DUNGEONS.find(x => x.value === dungeon);
  const rolesToPing = new Set(rolesNeeded);
  if (hostRole === 'tank') rolesToPing.delete('tank');
  else if (hostRole === 'heal') rolesToPing.delete('heal');
  // Pour DPS on garde le ping s'il reste des slots a remplir
  const pings = [];
  if (rolesToPing.has('tank')) pings.push(`<@&${ROLE_TANK_ID}>`);
  if (rolesToPing.has('heal')) pings.push(`<@&${ROLE_HEAL_ID}>`);
  if (rolesToPing.has('dps'))  pings.push(`<@&${ROLE_DPS_ID}>`);
  if (pings.length === 0) return `Un groupe se forme pour **${d?.label} +${level}** !`;
  return `${pings.join(' ')} - Un groupe se forme pour **${d?.label} +${level}** !`;
}

function dungeonName(value) { return DUNGEONS.find(d => d.value === value)?.label || value; }
function randomEncouragement() { return ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)]; }

// -- Creation canaux prives --
async function createPrivateChannels(guild, members, dungeon, level, hostId) {
  const memberIds = [members.tank, members.heal, ...members.dps].filter(Boolean);
  const safeName  = dungeonName(dungeon).toLowerCase().replace(/[^a-z0-9]/gi, '-').replace(/-+/g,'-').substring(0,20);

  const perms = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
    { id: ROLE_MODO_ID,   allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.Connect], deny: [PermissionFlagsBits.MentionEveryone, PermissionFlagsBits.SendMessages] },
    { id: ROLE_GERANT_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.Connect], deny: [PermissionFlagsBits.MentionEveryone, PermissionFlagsBits.SendMessages] },
    ...memberIds.map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] }))
  ];

  const voiceChannel = await guild.channels.create({
    name: `${dungeonName(dungeon)} +${level}`,
    type: ChannelType.GuildVoice,
    parent: CATEGORY_ID,
    permissionOverwrites: perms,
    position: 0,
  });

  const textChannel = await guild.channels.create({
    name: `cle-${safeName}-${level}`,
    type: ChannelType.GuildText,
    parent: CATEGORY_ID,
    permissionOverwrites: perms,
    position: 1,
  });

  const mentions = memberIds.map(id => `<@${id}>`).join(' ');
  await textChannel.send({
    content: `${mentions}\nVotre espace prive est cree ! Rejoignez le vocal <#${voiceChannel.id}> quand vous etes prets.`
  });

  const closeMsg = await textChannel.send({
    content: `<@${hostId}> - Quand la run est terminee, clique sur le bouton rouge pour cloturer. Si le salon vocal se ferme par erreur, utilise le bouton bleu pour en recreer un.`,
    components: [privateChannelButtons()]
  });
  await closeMsg.pin().catch(() => {});

  privateChans.set(textChannel.id, {
    voiceChannelId: voiceChannel.id,
    hostId,
    dungeon,
    level,
  });

  return { textChannel, voiceChannel };
}

// -- Publication dans le forum --
async function publishGroup(interaction, session) {
  const { dungeon, level, roles, hostRole, dpsCount } = session;
  const guild = interaction.guild;

  const members = { tank: null, heal: null, dps: [] };
  if (hostRole === 'tank') members.tank = interaction.user.id;
  else if (hostRole === 'heal') members.heal = interaction.user.id;
  else if (hostRole === 'dps') members.dps.push(interaction.user.id);

  const d = DUNGEONS.find(x => x.value === dungeon);
  const forumChannel = await guild.channels.fetch(FORUM_CHANNEL_ID).catch(() => null);
  if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
    await interaction.editReply({ content: 'Channel forum introuvable. Verifie FORUM_CHANNEL_ID.', components: [] });
    return;
  }

  const thread = await forumChannel.threads.create({
    name: `${interaction.member.displayName} - ${d?.label} - +${level}`,
    message: {
      content: pingLine(roles, hostRole, dungeon, level),
      embeds: [groupEmbed(dungeon, level, roles, members, interaction.member.displayName, dpsCount)],
      components: [joinButtons(roles, dpsCount)]
    },
  });

  let textChannelId = null, voiceChannelId = null;
  try {
    const priv = await createPrivateChannels(guild, members, dungeon, level, interaction.user.id);
    textChannelId  = priv.textChannel.id;
    voiceChannelId = priv.voiceChannel.id;
  } catch (e) { console.error('Erreur canaux prives:', e); }

  groups.set(thread.id, {
    dungeon, level,
    rolesNeeded: new Set(roles),
    dpsCount: dpsCount || 3,
    members,
    hostId: interaction.user.id,
    hostUsername: interaction.member.displayName,
    threadId: thread.id,
    complete: false,
    textChannelId,
    voiceChannelId,
  });

  const privMsg = textChannelId ? ` - Espace prive : <#${textChannelId}>` : '';
  await interaction.editReply({ content: `Groupe publie ! <#${thread.id}>${privMsg}`, components: [] });

  // Timer 1h
  setTimeout(async () => {
    const group = groups.get(thread.id);
    if (!group || group.complete) return;
    const filled = (group.members.tank?1:0)+(group.members.heal?1:0)+group.members.dps.length;
    if (filled === 0 && group.textChannelId) {
      const chanData = privateChans.get(group.textChannelId);
      if (chanData) {
        const voiceChan = await guild.channels.fetch(chanData.voiceChannelId).catch(() => null);
        if (voiceChan) await voiceChan.delete().catch(() => {});
        const textChan = await guild.channels.fetch(group.textChannelId).catch(() => null);
        if (textChan) await textChan.delete().catch(() => {});
        privateChans.delete(group.textChannelId);
      }
    }
    groups.delete(thread.id);
  }, GROUP_TIMEOUT_MS);
}

// -- Client Discord --
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers]
});

client.once('clientReady', async () => {
  console.log(`KeyBot connecte : ${client.user.tag}`);
  await setupLFGChannel(client);
});

client.on('interactionCreate', async interaction => {
  const userId = interaction.user.id;

  // -- Recreer le salon vocal --
  if (interaction.isButton() && interaction.customId === 'recreate_voice') {
    const chanData = privateChans.get(interaction.channelId);
    if (!chanData) { await interaction.reply({ content: 'Canal introuvable.', ephemeral: true }); return; }
    const member   = await interaction.guild.members.fetch(userId).catch(() => null);
    const isModo   = member?.roles.cache.has(ROLE_MODO_ID);
    const isGerant = member?.roles.cache.has(ROLE_GERANT_ID);
    const isHost   = chanData.hostId === userId;
    if (!isHost && !isModo && !isGerant) {
      await interaction.reply({ content: 'Seul le createur, un Moderateur ou le Gerant peut recreer le vocal.', ephemeral: true });
      return;
    }
    // Supprimer l'ancien vocal s'il existe
    if (chanData.voiceChannelId) {
      const oldVoice = await interaction.guild.channels.fetch(chanData.voiceChannelId).catch(() => null);
      if (oldVoice) await oldVoice.delete().catch(() => {});
    }
    // Recreer avec les memes permissions que le canal texte
    const perms = interaction.channel.permissionOverwrites.cache.map(o => ({
      id: o.id, allow: o.allow.toArray(), deny: o.deny.toArray()
    }));
    const newVoice = await interaction.guild.channels.create({
      name: `${dungeonName(chanData.dungeon)} +${chanData.level}`,
      type: ChannelType.GuildVoice,
      parent: CATEGORY_ID,
      permissionOverwrites: perms,
      position: 0,
    }).catch(() => null);
    if (newVoice) {
      chanData.voiceChannelId = newVoice.id;
      await interaction.reply({ content: `Nouveau salon vocal cree : <#${newVoice.id}>`, ephemeral: true });
    } else {
      await interaction.reply({ content: 'Impossible de creer le salon vocal.', ephemeral: true });
    }
    return;
  }

  // -- Fermer le salon vocal manuellement --
  if (interaction.isButton() && interaction.customId === 'close_voice') {
    const chanData = privateChans.get(interaction.channelId);
    if (!chanData) { await interaction.reply({ content: 'Canal introuvable.', ephemeral: true }); return; }
    const member   = await interaction.guild.members.fetch(userId).catch(() => null);
    const isModo   = member?.roles.cache.has(ROLE_MODO_ID);
    const isGerant = member?.roles.cache.has(ROLE_GERANT_ID);
    const isHost   = chanData.hostId === userId;
    if (!isHost && !isModo && !isGerant) {
      await interaction.reply({ content: 'Seul le createur, un Moderateur ou le Gerant peut fermer le vocal.', ephemeral: true });
      return;
    }
    const voiceChannel = await interaction.guild.channels.fetch(chanData.voiceChannelId).catch(() => null);
    if (voiceChannel) {
      await voiceChannel.delete().catch(() => {});
      chanData.voiceChannelId = null;
      await interaction.reply({ content: 'Salon vocal ferme.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'Le salon vocal est deja ferme.', ephemeral: true });
    }
    return;
  }

  // -- Cloture des inscriptions (forum) --
  if (interaction.isButton() && interaction.customId === 'close_inscriptions') {
    const group = groups.get(interaction.channelId);
    if (!group) return;
    const member   = await interaction.guild.members.fetch(userId).catch(() => null);
    const isModo   = member?.roles.cache.has(ROLE_MODO_ID);
    const isGerant = member?.roles.cache.has(ROLE_GERANT_ID);
    const isHost   = group.hostId === userId;
    if (!isHost && !isModo && !isGerant) {
      await interaction.reply({ content: 'Seul le createur, un Moderateur ou le Gerant peut cloturer les inscriptions.', ephemeral: true });
      return;
    }
    group.complete = true;
    const embed = groupEmbed(group.dungeon, group.level, group.rolesNeeded, group.members, group.hostUsername, group.dpsCount || 3);
    await interaction.update({ embeds: [embed], components: [] });
    await interaction.channel.send({ content: 'Inscriptions cloturees par le createur du groupe.' });
    return;
  }
  if (interaction.isButton() && interaction.customId === 'close_channel') {
    const chanData = privateChans.get(interaction.channelId);
    if (!chanData) { await interaction.reply({ content: 'Canal introuvable.', ephemeral: true }); return; }
    const member   = await interaction.guild.members.fetch(userId).catch(() => null);
    const isModo   = member?.roles.cache.has(ROLE_MODO_ID);
    const isGerant = member?.roles.cache.has(ROLE_GERANT_ID);
    const isHost   = chanData.hostId === userId;
    if (!isHost && !isModo && !isGerant) {
      await interaction.reply({ content: 'Seul le createur, un Moderateur ou le Gerant peut cloturer ce canal.', ephemeral: true });
      return;
    }
    await interaction.reply({ content: 'Cloture du canal texte en cours... Le salon vocal reste actif tant que vous en avez besoin.' });
    // On supprime uniquement le canal texte, pas le vocal
    setTimeout(() => interaction.channel.delete().catch(() => {}), 2000);
    privateChans.delete(interaction.channelId);
    return;
  }

  // -- Ouvrir menu creation --
  const openMenu = async () => {
    sessions.set(userId, { dungeon: null, level: null, roles: new Set(), dpsCount: 3, hostRole: null });
    await interaction.reply({
      content: 'Creer un groupe Mythic+\nEtape 1/3 - Choisis le donjon :',
      components: [dungeonSelect()],
      ephemeral: true
    });
  };
  if (interaction.isButton() && interaction.customId === 'open_lfm') { await openMenu(); return; }
  if (interaction.isChatInputCommand() && interaction.commandName === 'lfm') { await openMenu(); return; }

  // -- Selection donjon --
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_dungeon') {
    const s = sessions.get(userId) || { dungeon: null, level: null, roles: new Set(), dpsCount: 3, hostRole: null };
    s.dungeon = interaction.values[0];
    sessions.set(userId, s);
    const d = DUNGEONS.find(x => x.value === s.dungeon);
    await interaction.update({ content: `Etape 2/3 - Niveau de cle :\nDonjon : ${d?.label}`, components: levelSelectRows() });
    return;
  }

  // -- Selection niveau --
  if (interaction.isStringSelectMenu() && ['select_level','select_level_high'].includes(interaction.customId)) {
    const s = sessions.get(userId);
    if (!s) return;
    s.level = interaction.values[0];
    const d = DUNGEONS.find(x => x.value === s.dungeon);
    await interaction.update({ content: `Etape 3/3 - Roles recherches :\n${d?.label} +${s.level}`, components: [roleToggleButtons(s.roles)] });
    return;
  }

  // -- Toggle roles --
  if (interaction.isButton() && ['toggle_tank','toggle_heal'].includes(interaction.customId)) {
    const s = sessions.get(userId);
    if (!s) return;
    const role = interaction.customId.replace('toggle_', '');
    s.roles.has(role) ? s.roles.delete(role) : s.roles.add(role);
    const d = DUNGEONS.find(x => x.value === s.dungeon);
    await interaction.update({ content: `Etape 3/3 - Roles recherches :\n${d?.label} +${s.level}`, components: [roleToggleButtons(s.roles)] });
    return;
  }

  // -- Toggle DPS -> affiche le selecteur de nombre --
  if (interaction.isButton() && interaction.customId === 'toggle_dps') {
    const s = sessions.get(userId);
    if (!s) return;
    const d = DUNGEONS.find(x => x.value === s.dungeon);
    if (s.roles.has('dps')) {
      // Desactiver DPS
      s.roles.delete('dps');
      await interaction.update({ content: `Etape 3/3 - Roles recherches :\n${d?.label} +${s.level}`, components: [roleToggleButtons(s.roles)] });
    } else {
      // Activer DPS -> demander combien
      s.roles.add('dps');
      await interaction.update({ content: `Combien de DPS tu cherches ?\n${d?.label} +${s.level}`, components: [dpsCountSelect()] });
    }
    return;
  }

  // -- Selection nombre de DPS --
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_dps_count') {
    const s = sessions.get(userId);
    if (!s) return;
    s.dpsCount = parseInt(interaction.values[0]);
    const d = DUNGEONS.find(x => x.value === s.dungeon);
    await interaction.update({ content: `Etape 3/3 - Roles recherches (${s.dpsCount} DPS) :\n${d?.label} +${s.level}`, components: [roleToggleButtons(s.roles)] });
    return;
  }

  // -- Publier -> demander role createur --
  if (interaction.isButton() && interaction.customId === 'publish_group') {
    const s = sessions.get(userId);
    if (!s || s.roles.size === 0) return;
    const d = DUNGEONS.find(x => x.value === s.dungeon);
    await interaction.update({
      content: `Derniere etape - Quel role tu joues ?\n${d?.label} +${s.level}`,
      components: [hostRoleButtons()]
    });
    return;
  }

  // -- Role createur -> publication --
  if (interaction.isButton() && ['host_tank','host_heal','host_dps','host_none'].includes(interaction.customId)) {
    const s = sessions.get(userId);
    if (!s) return;
    s.hostRole = interaction.customId.replace('host_', '');
    await interaction.deferUpdate();
    await publishGroup(interaction, s);
    sessions.delete(userId);
    return;
  }

  // -- Rejoindre / quitter (thread forum) --
  if (!interaction.isButton()) return;
  const group = groups.get(interaction.channelId);
  if (!group) return;

  const alreadyTank = group.members.tank === userId;
  const alreadyHeal = group.members.heal === userId;
  const alreadyDps  = group.members.dps.includes(userId);
  const alreadyIn   = alreadyTank || alreadyHeal || alreadyDps;

  if (interaction.customId === 'join_tank') {
    if (alreadyIn) { await interaction.reply({ content: 'Tu es deja inscrit dans ce groupe !', ephemeral: true }); return; }
    if (group.members.tank) { await interaction.reply({ content: 'Le slot Tank est deja pris !', ephemeral: true }); return; }
    group.members.tank = userId;
  } else if (interaction.customId === 'join_heal') {
    if (alreadyIn) { await interaction.reply({ content: 'Tu es deja inscrit dans ce groupe !', ephemeral: true }); return; }
    if (group.members.heal) { await interaction.reply({ content: 'Le slot Heal est deja pris !', ephemeral: true }); return; }
    group.members.heal = userId;
  } else if (interaction.customId === 'join_dps') {
    if (alreadyIn) { await interaction.reply({ content: 'Tu es deja inscrit dans ce groupe !', ephemeral: true }); return; }
    if (group.members.dps.length >= (group.dpsCount || 3)) { await interaction.reply({ content: 'Les slots DPS sont tous pris !', ephemeral: true }); return; }
    group.members.dps.push(userId);
  } else if (interaction.customId === 'leave_group') {
    if (group.members.tank === userId) group.members.tank = null;
    else if (group.members.heal === userId) group.members.heal = null;
    else group.members.dps = group.members.dps.filter(id => id !== userId);
  } else return;

  // Donner acces aux canaux prives au nouveau membre
  if (interaction.customId !== 'leave_group' && group.textChannelId) {
    const textChan  = await interaction.guild.channels.fetch(group.textChannelId).catch(() => null);
    const voiceChan = group.voiceChannelId ? await interaction.guild.channels.fetch(group.voiceChannelId).catch(() => null) : null;
    if (textChan)  await textChan.permissionOverwrites.create(userId,  { ViewChannel: true, SendMessages: true }).catch(() => {});
    if (voiceChan) await voiceChan.permissionOverwrites.create(userId, { ViewChannel: true, Connect: true, Speak: true }).catch(() => {});
  }

  // Total = roles recherches + role du createur
  const dpsCount = group.dpsCount || 3;
  const TOTAL_PLAYERS = (group.rolesNeeded.has('tank')?1:0) + (group.rolesNeeded.has('heal')?1:0) + (group.rolesNeeded.has('dps')?dpsCount:0)
    + ((!group.rolesNeeded.has('tank') && group.members.tank)?1:0)
    + ((!group.rolesNeeded.has('heal') && group.members.heal)?1:0)
    + ((!group.rolesNeeded.has('dps') && group.members.dps.length > 0)?group.members.dps.length:0);
  const filled = (group.members.tank?1:0)+(group.members.heal?1:0)+group.members.dps.length;
  const embed  = groupEmbed(group.dungeon, group.level, group.rolesNeeded, group.members, group.hostUsername, dpsCount);
  const isFull = filled >= TOTAL_PLAYERS;

  if (isFull) {
    group.complete = true;
    await interaction.update({ embeds: [embed], components: [] });
    await interaction.channel.send({ content: randomEncouragement() });
  } else {
    await interaction.update({ embeds: [embed], components: [joinButtons(group.rolesNeeded)] });
  }
});


registerCommands().then(() => client.login(TOKEN));
