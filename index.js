const { Client, GatewayIntentBits, AuditLogEvent, EmbedBuilder, PermissionsBitField } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildBans,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// --- AYARLAR ---
const CONFIG = {
    TOKEN: "TOKEN_BURAYA",
    LOG_CHANNEL_ID: "LOG_KANAL_ID_BURAYA", // Logların atılacağı kanal ID'si
    MUAF_ROL_ID: "1547917093058641961", // Sadece bu rol ve sunucu sahibi korumalardan muaf olacak
};

client.once('ready', () => {
    console.log(`[GUARD] ${client.user.tag} aktif ve katı koruma modu devrede!`);
});

// Log Gönderme Yardımcı Fonksiyonu
async function sendLog(guild, title, description, color = 0xFF0000) {
    try {
        const logChannel = guild.channels.cache.get(CONFIG.LOG_CHANNEL_ID);
        if (!logChannel) return;

        const embed = new EmbedBuilder()
            .setTitle(`🛡️ Sıkı Guard Bot - ${title}`)
            .setDescription(description)
            .setColor(color)
            .setTimestamp();

        await logChannel.send({ embeds: [embed] });
    } catch (err) {
        console.error("Log gönderilemedi:", err);
    }
}

// Muafiyet Kontrolü (Sadece sunucu sahibi ve muaf rol)
function isMuaf(member) {
    if (!member) return false;
    if (member.id === member.guild.ownerId) return true;
    return member.roles.cache.has(CONFIG.MUAF_ROL_ID);
}

// Yetkiliyi Cezalandırma ve Yetkilerini Alma Fonksiyonu
async function punishUnauthorizedUser(member, actionName) {
    try {
        // Tüm tehlikeli/yönetici rollerini al
        const adminRoles = member.roles.cache.filter(r => r.permissions.has(PermissionsBitField.Flags.Administrator) || r.permissions.has(PermissionsBitField.Flags.BanMembers) || r.permissions.has(PermissionsBitField.Flags.KickMembers));
        if (adminRoles.size > 0) {
            await member.roles.remove(adminRoles).catch(() => {});
        }
        // Sunucudan at
        await member.kick(`İzinsiz işlem (${actionName}) - Sıkı Guard Koruması`);
    } catch (e) {
        console.error("Cezalandırma hatası:", e);
    }
}

// 1. Anti-Bot Koruması (İzinsiz Bot Eklenmesi)
client.on('guildMemberAdd', async (member) => {
    if (!member.user.bot) return;

    const fetchedLogs = await member.guild.fetchAuditLogs({
        limit: 1,
        type: AuditLogEvent.BotAdd,
    });
    const botAddLog = fetchedLogs.entries.first();
    if (!botAddLog) return;

    const { executor } = botAddLog;
    const executorMember = await member.guild.members.fetch(executor.id).catch(() => null);

    if (!isMuaf(executorMember)) {
        try {
            await member.kick("İzinsiz bot eklendi - Guard Koruması");
            await punishUnauthorizedUser(executorMember, "Bot Ekleme");
            
            sendLog(
                member.guild,
                "İzinsiz Bot Engellendi!",
                `**Eklenen Bot:** ${member.user.tag}\n**İzinsiz Ekleyen Yetkili:** ${executor.tag} (Sunucudan atıldı ve yetkileri alındı).`
            );
        } catch (e) {
            console.error("Anti-bot işlem hatası:", e);
        }
    }
});

// 2. Anti-Ban Koruması (Muaf rol haricinde kim ban atarsa atılsın)
client.on('guildBanAdd', async (ban) => {
    const fetchedLogs = await ban.guild.fetchAuditLogs({
        limit: 1,
        type: AuditLogEvent.MemberBanAdd,
    });
    const banLog = fetchedLogs.entries.first();
    if (!banLog) return;

    const { executor } = banLog;
    const executorMember = await ban.guild.members.fetch(executor.id).catch(() => null);
    if (!executorMember) return;

    if (!isMuaf(executorMember)) {
        await punishUnauthorizedUser(executorMember, "Üye Yasaklama (Ban)");
        sendLog(
            ban.guild,
            "İzinsiz Ban İşlemi Engellendi!",
            `**Ban Atan Yetkili:** ${executor.tag}\n**Durum:** Muaf listede olmadığı için sunucudan atıldı ve yetkileri söküldü.`
        );
    }
});

// 3. Anti-Kick Koruması (Muaf rol haricinde kim üye atarsa atılsın)
client.on('guildMemberRemove', async (member) => {
    const fetchedLogs = await member.guild.fetchAuditLogs({
        limit: 1,
        type: AuditLogEvent.MemberKick,
    });
    const kickLog = fetchedLogs.entries.first();
    if (!kickLog) return;

    // Log zamanını kontrol et (eski loglarla karışmaması için güncel olmalı)
    const { executor, target } = kickLog;
    if (target.id !== member.id) return;

    const executorMember = await member.guild.members.fetch(executor.id).catch(() => null);
    if (!executorMember) return;

    if (!isMuaf(executorMember)) {
        await punishUnauthorizedUser(executorMember, "Üye Atma (Kick)");
        sendLog(
            member.guild,
            "İzinsiz Kick İşlemi Engellendi!",
            `**Kick Atan Yetkili:** ${executor.tag}\n**Durum:** Muaf listede olmadığı için sunucudan atıldı ve yetkileri söküldü.`
        );
    }
});

// 4. Kanal Koruma (İzinsiz Kanal Silme)
client.on('channelDelete', async (channel) => {
    const fetchedLogs = await channel.guild.fetchAuditLogs({
        limit: 1,
        type: AuditLogEvent.ChannelDelete,
    });
    const deleteLog = fetchedLogs.entries.first();
    if (!deleteLog) return;

    const { executor } = deleteLog;
    const executorMember = await channel.guild.members.fetch(executor.id).catch(() => null);
    if (!executorMember) return;

    if (!isMuaf(executorMember)) {
        await punishUnauthorizedUser(executorMember, "Kanal Silme");
        sendLog(
            channel.guild,
            "Kanal Silme Koruması Devrede!",
            `**Silinen Kanal:** ${channel.name}\n**Silen Yetkili:** ${executor.tag} (Muaf olmadığından atıldı ve yetkileri alındı).`
        );
    }
});

// 5. Rol Koruma (İzinsiz Rol Silme)
client.on('roleDelete', async (role) => {
    const fetchedLogs = await role.guild.fetchAuditLogs({
        limit: 1,
        type: AuditLogEvent.RoleDelete,
    });
    const deleteLog = fetchedLogs.entries.first();
    if (!deleteLog) return;

    const { executor } = deleteLog;
    const executorMember = await role.guild.members.fetch(executor.id).catch(() => null);
    if (!executorMember) return;

    if (!isMuaf(executorMember)) {
        await punishUnauthorizedUser(executorMember, "Rol Silme");
        sendLog(
            role.guild,
            "Rol Silme Koruması Devrede!",
            `**Silinen Rol:** ${role.name}\n**Silen Yetkili:** ${executor.tag} (Muaf olmadığından atıldı ve yetkileri alındı).`
        );
    }
});

client.login(CONFIG.TOKEN);
