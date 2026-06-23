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
const LFG_CHANNEL_ID    = '1509506151866433686';
const FORUM_CHANNEL_ID  = '1518250666030530644';
const CATEGORY_ID       = '1508028184967512126';
const ROLE_TANK_ID      = '1415752673910718634';
const ROLE_HEAL_ID      = '1415752675609284629';
const ROLE_DPS_ID       = '1415752676930486347';
const ROLE_MODO_ID      = '1401884404779061369';
const ROLE_GERANT_ID    = '1508058886794383471';
const ROLE_COMMUNITY_ID = '1401886755384332320';
const GROUP_TIMEOUT_MS  = 60 * 60 * 1000; // 1 heure

// ──────────────────────────────────────────
// Donjons — Saison 1 Midnight
// ──────────────────────────────────────────
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

// Un groupe = 1 tank + 1 heal + 3 DPS
// Selon le role du createur, on deduit les roles recherches
function getRolesNeeded(hostRole) {
  const needed = new Set();
  if (hostRole !== 'tank') needed.add('tank');
  if (hostRole !== 'heal') needed.add('heal');
  needed.add('dps'); // toujours des DPS a chercher
  return needed;
}

// Nombre de DPS recherches selon le role du createur
function getDpsNeeded(hostRole) {
  return hostRole === 'dps' ? 2 : 3;
}

const sessions     = new Map(); // userId -> session en cours
const groups       = new Map(); // threadId -> groupe
const voiceChans   = new Map(); // voiceChannelId -> { hostId, dungeon, level }

// ──────────────────────────────────────────
// Enregistrement /lfm
// ──────────────────────────────────────────
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), {
    body: [new SlashCommandBuilder().setName('lfm').setDescription('Creer un groupe Mythic+ en quelques clics').toJSON()]
  });
  console.log('Commande /lfm enregistree');
}

// ──────────────────────────────────────────
// Message permanent LFG
// ──────────────────────────────────────────
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

// ──────────────────────────────────────────
// Composants UI
// ──────────────────────────────────────────
const dungeonSelect = () => new ActionRowBuilder().addComponents(
  new StringSelectMenuBuilder().setCustomId('select_dungeon').setPlaceholder('Choisir un donjon...')
    .addOptions(DUNGEONS.map(d => ({ label: d.label, value: d.value, emoji: d.emoji })))
);

const levelSelectRows = () => {
  const rows = [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('select_level')
        .setPlaceholder('Niveau +2 a +26...')
        .addOptions(KEY_LEVELS.slice(0, 25).map(l => ({ label: `+${l}`, value: String(l) })))
    )
  ];
  if (KEY_LEVELS.length > 25) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('select_level_high')
        .setPlaceholder('Niveau +27 a +30...')
        .addOptions(KEY_LEVELS.slice(25).map(l => ({ label: `+${l}`, value: String(l) })))
    ));
  }
  return rows;
};

// Etape 4 : choix du role du createur + publier + import vocal
const hostRoleButtons = (hasVocal = false) => {
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('host_tank').setLabel('Je joue Tank').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('host_heal').setLabel('Je joue Heal').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('host_dps').setLabel('Je joue DPS').setStyle(ButtonStyle.Danger),
    )
  ];
  const row2 = new ActionRowBuilder();
  if (hasVocal) row2.addComponents(
    new ButtonBuilder().setCustomId('import_vocal').setLabel('Importer le groupe vocal').setStyle(ButtonStyle.Primary)
  );
  row2.addComponents(
    new ButtonBuilder().setCustomId('publish_group').setLabel('Publier le groupe').setStyle(ButtonStyle.Secondary)
  );
  rows.push(row2);
  return rows;
};

const joinButtons = (rolesNeeded, dpsNeeded, dpsCount) => {
  const row = new ActionRowBuilder();
  if (rolesNeeded.has('tank')) row.addComponents(new ButtonBuilder().setCustomId('join_tank').setLabel('Tank').setStyle(ButtonStyle.Primary));
  if (rolesNeeded.has('heal')) row.addComponents(new ButtonBuilder().setCustomId('join_heal').setLabel('Heal').setStyle(ButtonStyle.Success));
  if (rolesNeeded.has('dps') && dpsCount < dpsNeeded) row.addComponents(new ButtonBuilder().setCustomId('join_dps').setLabel('DPS').setStyle(ButtonStyle.Danger));
  row.addComponents(new ButtonBuilder().setCustomId('leave_group').setLabel('Quitter').setStyle(ButtonStyle.Secondary));
  return row;
};

// Bouton vocal uniquement (plus de bouton texte)
const vocalButtons = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('recreate_voice').setLabel('Recreer le salon vocal').setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId('close_voice').setLabel('Fermer le salon vocal').setStyle(ButtonStyle.Secondary)
);

// Bouton cloture sur le post forum (createur uniquement)
const forumCloseButton = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('close_forum').setLabel('Cloturer le groupe').setStyle(ButtonStyle.Danger)
);

// ──────────────────────────────────────────
// Embed du groupe
// ──────────────────────────────────────────
function groupEmbed(dungeon, level, hostRole, members, hostUsername) {
  const d = DUNGEONS.find(x => x.value === dungeon);
  const dpsNeeded = getDpsNeeded(hostRole);
  const lines = [];

  // Tank
  lines.push(`Tank - ${members.tank ? `<@${members.tank}>` : 'En attente...'}`);
  // Heal
  lines.push(`Heal - ${members.heal ? `<@${members.heal}>` : 'En attente...'}`);
  // DPS (toujours 3 slots affiches)
  const filledDps = members.dps.map(id => `<@${id}>`);
  const emptyDps  = Array(Math.max(0, 3 - members.dps.length)).fill('En attente...');
  [...filledDps, ...emptyDps].forEach(x => lines.push(`DPS - ${x}`));

  const filled = (members.tank?1:0) + (members.heal?1:0) + members.dps.length;
  const total  = 5;

  return new EmbedBuilder()
    .setTitle(`${d?.emoji} ${d?.label} - Cle +${level}`)
    .setDescription(`Groupe cree par **${hostUsername}**\n\n${lines.join('\n')}`)
    .setColor(filled >= total ? 0x57ab5a : 0x5865f2)
    .setFooter({ text: filled >= total ? 'Groupe complet !' : `${filled}/${total} joueurs - Saison 1 Midnight` })
    .setTimestamp();
}

function pingLine(hostRole, dungeon, level) {
  const d = DUNGEONS.find(x => x.value === dungeon);
  const pings = [];
  if (hostRole !== 'tank') pings.push(`<@&${ROLE_TANK_ID}>`);
  if (hostRole !== 'heal') pings.push(`<@&${ROLE_HEAL_ID}>`);
  pings.push(`<@&${ROLE_DPS_ID}>`);
  return `${pings.join(' ')} - Un groupe se forme pour **${d?.label} +${level}** !`;
}

function dungeonName(value) { return DUNGEONS.find(d => d.value === value)?.label || value; }
function randomEncouragement() { return ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)]; }

// ──────────────────────────────────────────
// Detection membres dans le vocal
// ──────────────────────────────────────────
async function detectVocalMembers(guild, userId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member?.voice?.channelId) return null;
  const voiceChannel = await guild.channels.fetch(member.voice.channelId).catch(() => null);
  if (!voiceChannel) return null;

  const results = [];
  for (const [, m] of voiceChannel.members) {
    if (m.id === userId) continue;
    const hasTank = m.roles.cache.has(ROLE_TANK_ID);
    const hasHeal = m.roles.cache.has(ROLE_HEAL_ID);
    const hasDps  = m.roles.cache.has(ROLE_DPS_ID);
    const roleCount = [hasTank, hasHeal, hasDps].filter(Boolean).length;
    results.push({
      id: m.id,
      displayName: m.displayName,
      hasTank, hasHeal, hasDps,
      hasCommunityOnly: !hasTank && !hasHeal && !hasDps,
      roleCount,
      autoRole: roleCount === 1 ? (hasTank ? 'tank' : hasHeal ? 'heal' : 'dps') : null,
    });
  }
  return results.length > 0 ? { channelId: voiceChannel.id, members: results } : null;
}

// ──────────────────────────────────────────
// Creation salon vocal prive
// ──────────────────────────────────────────
async function createVoiceChannel(guild, members, dungeon, level, hostId) {
  const memberIds = [members.tank, members.heal, ...members.dps].filter(Boolean);
  const perms = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.Connect] },
    { id: ROLE_MODO_ID,   allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels], deny: [PermissionFlagsBits.SendMessages] },
    { id: ROLE_GERANT_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels], deny: [PermissionFlagsBits.SendMessages] },
    ...memberIds.map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] }))
  ];

  const voiceChannel = await guild.channels.create({
    name: `${dungeonName(dungeon)} +${level}`,
    type: ChannelType.GuildVoice,
    parent: CATEGORY_ID,
    permissionOverwrites: perms,
    position: 0,
  });

  voiceChans.set(voiceChannel.id, { hostId, dungeon, level });
  return voiceChannel;
}

// ──────────────────────────────────────────
// Publication dans le forum
// ──────────────────────────────────────────
async function publishGroup(interaction, session) {
  const { dungeon, level, hostRole, preImport } = session;
  const guild = interaction.guild;
  const hostUsername = interaction.member.displayName;

  // Membres initiaux
  const members = { tank: null, heal: null, dps: [] };
  if (hostRole === 'tank') members.tank = interaction.user.id;
  else if (hostRole === 'heal') members.heal = interaction.user.id;
  else if (hostRole === 'dps') members.dps.push(interaction.user.id);

  // Pre-inscriptions depuis le vocal
  if (preImport) {
    for (const p of preImport) {
      if (p.role === 'tank' && !members.tank) members.tank = p.id;
      else if (p.role === 'heal' && !members.heal) members.heal = p.id;
      else if (p.role === 'dps' && members.dps.length < 3) members.dps.push(p.id);
    }
  }

  const dpsNeeded = getDpsNeeded(hostRole);
  const rolesNeeded = getRolesNeeded(hostRole);
  const d = DUNGEONS.find(x => x.value === dungeon);

  const forumChannel = await guild.channels.fetch(FORUM_CHANNEL_ID).catch(() => null);
  if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
    await interaction.editReply({ content: 'Channel forum introuvable.', components: [] });
    return;
  }

  const filled = (members.tank?1:0)+(members.heal?1:0)+members.dps.length;
  const isFull = filled >= 5;

  const thread = await forumChannel.threads.create({
    name: `${hostUsername} - ${d?.label} - +${level}`,
    message: {
      content: pingLine(hostRole, dungeon, level),
      embeds: [groupEmbed(dungeon, level, hostRole, members, hostUsername)],
      components: isFull ? [forumCloseButton()] : [joinButtons(rolesNeeded, dpsNeeded, members.dps.length), forumCloseButton()],
    },
  });

  // Salon vocal prive
  let voiceChannelId = null;
  try {
    const vc = await createVoiceChannel(guild, members, dungeon, level, interaction.user.id);
    voiceChannelId = vc.id;
    // Message vocal dans le thread
    await thread.send({ content: `Votre salon vocal prive : <#${voiceChannelId}>\n\n${vocalButtons().components.map(()=>'').join('')}`, components: [vocalButtons()] });
  } catch(e) { console.error('Erreur vocal:', e); }

  groups.set(thread.id, {
    dungeon, level, hostRole, hostId: interaction.user.id, hostUsername,
    rolesNeeded, dpsNeeded,
    members,
    complete: isFull,
    voiceChannelId,
    threadId: thread.id,
  });

  await interaction.editReply({ content: `Groupe publie ! <#${thread.id}>`, components: [] });

  // Timer 1h : supprime le vocal si 0 inscrit
  setTimeout(async () => {
    const group = groups.get(thread.id);
    if (!group) return;
    const f = (group.members.tank?1:0)+(group.members.heal?1:0)+group.members.dps.length;
    if (f <= 1 && group.voiceChannelId) {
      const vc = await guild.channels.fetch(group.voiceChannelId).catch(() => null);
      if (vc) await vc.delete().catch(() => {});
      voiceChans.delete(group.voiceChannelId);
    }
    groups.delete(thread.id);
  }, GROUP_TIMEOUT_MS);
}

// ──────────────────────────────────────────
// Client Discord
// ──────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers]
});

client.once('clientReady', async () => {
  console.log(`KeyBot connecte : ${client.user.tag}`);
  await setupLFGChannel(client);
});

client.on('interactionCreate', async interaction => {
  const userId = interaction.user.id;

  // ── Recreer le vocal ──
  if (interaction.isButton() && interaction.customId === 'recreate_voice') {
    // Trouver le groupe associe au thread
    const group = [...groups.values()].find(g => g.threadId === interaction.channelId);
    if (!group) { await interaction.reply({ content: 'Groupe introuvable.', ephemeral: true }); return; }
    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    if (!member?.roles.cache.has(ROLE_MODO_ID) && !member?.roles.cache.has(ROLE_GERANT_ID) && group.hostId !== userId) {
      await interaction.reply({ content: 'Seul le createur, un Moderateur ou le Gerant peut recreer le vocal.', ephemeral: true }); return;
    }
    if (group.voiceChannelId) {
      const old = await interaction.guild.channels.fetch(group.voiceChannelId).catch(() => null);
      if (old) await old.delete().catch(() => {});
    }
    const vc = await createVoiceChannel(interaction.guild, group.members, group.dungeon, group.level, group.hostId).catch(() => null);
    if (vc) {
      group.voiceChannelId = vc.id;
      await interaction.reply({ content: `Nouveau salon vocal : <#${vc.id}>`, ephemeral: true });
    }
    return;
  }

  // ── Fermer le vocal ──
  if (interaction.isButton() && interaction.customId === 'close_voice') {
    const group = [...groups.values()].find(g => g.threadId === interaction.channelId);
    if (!group) { await interaction.reply({ content: 'Groupe introuvable.', ephemeral: true }); return; }
    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    if (!member?.roles.cache.has(ROLE_MODO_ID) && !member?.roles.cache.has(ROLE_GERANT_ID) && group.hostId !== userId) {
      await interaction.reply({ content: 'Seul le createur, un Moderateur ou le Gerant peut fermer le vocal.', ephemeral: true }); return;
    }
    if (group.voiceChannelId) {
      const vc = await interaction.guild.channels.fetch(group.voiceChannelId).catch(() => null);
      if (vc) await vc.delete().catch(() => {});
      voiceChans.delete(group.voiceChannelId);
      group.voiceChannelId = null;
    }
    await interaction.reply({ content: 'Salon vocal ferme.', ephemeral: true });
    return;
  }

  // ── Cloturer le groupe (forum) ──
  if (interaction.isButton() && interaction.customId === 'close_forum') {
    const group = groups.get(interaction.channelId);
    if (!group) { await interaction.reply({ content: 'Groupe introuvable.', ephemeral: true }); return; }
    if (group.hostId !== userId) {
      await interaction.reply({ content: 'Seul le createur peut cloturer ce groupe.', ephemeral: true }); return;
    }
    group.complete = true;
    const embed = groupEmbed(group.dungeon, group.level, group.hostRole, group.members, group.hostUsername);
    await interaction.update({ embeds: [embed], components: [vocalButtons()] });
    await interaction.channel.send({ content: 'Groupe cloture par le createur.' });
    return;
  }

  // ── Ouvrir menu creation ──
  const openMenu = async () => {
    sessions.set(userId, { dungeon: null, level: null, hostRole: null, preImport: null });
    await interaction.reply({
      content: 'Creer un groupe Mythic+\nEtape 1/3 - Choisis le donjon :',
      components: [dungeonSelect()],
      ephemeral: true
    });
  };
  if (interaction.isButton() && interaction.customId === 'open_lfm') { await openMenu(); return; }
  if (interaction.isChatInputCommand() && interaction.commandName === 'lfm') { await openMenu(); return; }

  // ── Selection donjon ──
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_dungeon') {
    const s = sessions.get(userId) || { dungeon: null, level: null, hostRole: null, preImport: null };
    s.dungeon = interaction.values[0];
    sessions.set(userId, s);
    const d = DUNGEONS.find(x => x.value === s.dungeon);
    await interaction.update({ content: `Etape 2/3 - Niveau de cle :\n${d?.emoji} ${d?.label}`, components: levelSelectRows() });
    return;
  }

  // ── Selection niveau ──
  if (interaction.isStringSelectMenu() && ['select_level','select_level_high'].includes(interaction.customId)) {
    const s = sessions.get(userId);
    if (!s) return;
    s.level = interaction.values[0];
    sessions.set(userId, s);
    const d = DUNGEONS.find(x => x.value === s.dungeon);
    // Detecter si dans un vocal
    const vocalData = await detectVocalMembers(interaction.guild, userId);
    s.vocalData = vocalData;
    sessions.set(userId, s);
    await interaction.update({
      content: `Etape 3/3 - Quel role tu joues ?\n${d?.emoji} ${d?.label} +${s.level}${vocalData ? `\n*${vocalData.members.length} joueur(s) detecte(s) dans ton vocal*` : ''}`,
      components: hostRoleButtons(!!vocalData)
    });
    return;
  }

  // ── Import vocal ──
  if (interaction.isButton() && interaction.customId === 'import_vocal') {
    const s = sessions.get(userId);
    if (!s?.vocalData) return;
    if (!s.preImport) s.preImport = [];

    for (const m of s.vocalData.members) {
      if (m.autoRole) {
        s.preImport.push({ id: m.id, role: m.autoRole, name: m.displayName });
      } else if (m.hasCommunityOnly) {
        const gm = await interaction.guild.members.fetch(m.id).catch(() => null);
        if (gm) await gm.send({ content: `Salut ${m.displayName} ! Pour etre importe automatiquement dans les prochains groupes M+, pense a choisir ton role (Tank, Heal ou DPS) sur le serveur. Tu peux toujours t'inscrire manuellement dans l'annonce !` }).catch(() => {});
      } else {
        const gm = await interaction.guild.members.fetch(m.id).catch(() => null);
        if (gm) {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`vr_tank_${userId}`).setLabel('Tank').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`vr_heal_${userId}`).setLabel('Heal').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`vr_dps_${userId}`).setLabel('DPS').setStyle(ButtonStyle.Danger),
          );
          await gm.send({ content: `Salut ${m.displayName} ! Un groupe M+ se forme, quel role tu joues ?`, components: [row] }).catch(() => {});
        }
      }
    }
    sessions.set(userId, s);
    const d = DUNGEONS.find(x => x.value === s.dungeon);
    await interaction.update({
      content: `Membres notifies ! Maintenant, quel role TU joues ?\n${d?.emoji} ${d?.label} +${s.level}`,
      components: hostRoleButtons(false)
    });
    return;
  }

  // ── Reponse role depuis MP ──
  if (interaction.isButton() && interaction.customId.startsWith('vr_')) {
    const parts = interaction.customId.split('_');
    const role   = parts[1];
    const hostId = parts[2];
    const s = sessions.get(hostId);
    if (!s) { await interaction.reply({ content: 'Le groupe n\'est plus disponible.', ephemeral: true }); return; }
    if (!s.preImport) s.preImport = [];
    if (!s.preImport.find(p => p.id === interaction.user.id)) {
      s.preImport.push({ id: interaction.user.id, role, name: interaction.user.username });
      sessions.set(hostId, s);
    }
    await interaction.reply({ content: `Inscrit en tant que **${role}** !`, ephemeral: true });
    return;
  }

  // ── Role createur -> publication ──
  if (interaction.isButton() && ['host_tank','host_heal','host_dps','publish_group'].includes(interaction.customId)) {
    const s = sessions.get(userId);
    if (!s) return;

    if (interaction.customId === 'publish_group') {
      if (!s.hostRole) {
        await interaction.reply({ content: 'Choisis d\'abord ton role avant de publier !', ephemeral: true }); return;
      }
    } else {
      s.hostRole = interaction.customId.replace('host_', '');
      sessions.set(userId, s);
      const d = DUNGEONS.find(x => x.value === s.dungeon);
      // Juste mettre a jour le bouton selectionne visuellement, attendre "Publier"
      await interaction.update({
        content: `Role selectionne : **${s.hostRole.toUpperCase()}**\nClique sur "Publier le groupe" quand tu es pret !\n${d?.emoji} ${d?.label} +${s.level}`,
        components: hostRoleButtons(!!s.vocalData)
      });
      return;
    }

    await interaction.deferUpdate();
    await publishGroup(interaction, s);
    sessions.delete(userId);
    return;
  }

  // ── Rejoindre / quitter (thread forum) ──
  if (!interaction.isButton()) return;
  const group = groups.get(interaction.channelId);
  if (!group || group.complete) return;

  const alreadyIn = group.members.tank === userId || group.members.heal === userId || group.members.dps.includes(userId);

  if (interaction.customId === 'join_tank') {
    if (alreadyIn) { await interaction.reply({ content: 'Tu es deja inscrit !', ephemeral: true }); return; }
    if (group.members.tank) { await interaction.reply({ content: 'Le slot Tank est deja pris !', ephemeral: true }); return; }
    group.members.tank = userId;
  } else if (interaction.customId === 'join_heal') {
    if (alreadyIn) { await interaction.reply({ content: 'Tu es deja inscrit !', ephemeral: true }); return; }
    if (group.members.heal) { await interaction.reply({ content: 'Le slot Heal est deja pris !', ephemeral: true }); return; }
    group.members.heal = userId;
  } else if (interaction.customId === 'join_dps') {
    if (alreadyIn) { await interaction.reply({ content: 'Tu es deja inscrit !', ephemeral: true }); return; }
    if (group.members.dps.length >= group.dpsNeeded) { await interaction.reply({ content: 'Les slots DPS sont tous pris !', ephemeral: true }); return; }
    group.members.dps.push(userId);
  } else if (interaction.customId === 'leave_group') {
    if (group.members.tank === userId) group.members.tank = null;
    else if (group.members.heal === userId) group.members.heal = null;
    else group.members.dps = group.members.dps.filter(id => id !== userId);
  } else return;

  // Donner acces au vocal au nouveau membre
  if (interaction.customId !== 'leave_group' && group.voiceChannelId) {
    const vc = await interaction.guild.channels.fetch(group.voiceChannelId).catch(() => null);
    if (vc) await vc.permissionOverwrites.create(userId, { ViewChannel: true, Connect: true, Speak: true }).catch(() => {});
  }

  const filled = (group.members.tank?1:0)+(group.members.heal?1:0)+group.members.dps.length;
  const isFull = filled >= 5;
  const embed  = groupEmbed(group.dungeon, group.level, group.hostRole, group.members, group.hostUsername);

  if (isFull) {
    group.complete = true;
    await interaction.update({ embeds: [embed], components: [vocalButtons(), forumCloseButton()] });
    await interaction.channel.send({ content: randomEncouragement() });
  } else {
    await interaction.update({
      embeds: [embed],
      components: [joinButtons(group.rolesNeeded, group.dpsNeeded, group.members.dps.length), forumCloseButton()]
    });
  }
});

registerCommands().then(() => client.login(TOKEN));
