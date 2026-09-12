require('dotenv').config();
const { Client, GatewayIntentBits, AuditLogEvent, PermissionFlagsBits, ChannelType } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice'); // Ses kanalında 7/24 kalmak için

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Ayarlar ve ID'ler
const CONFIG = {
    logChannelId: '1548383428930441258', // Logların düşeceği kanal
    voiceChannelId: '1547915520303435816', // Botun 7/24 duracağı ses kanalı
    bypassRoleId: '1547917093058641961', // Bu role sahip kişilere işlem yapılmaz ve banlanmaz
};

// Spam takibi için hafıza
const messageTracker = new Map();

client.once('ready', async () => {
    console.log(`Guard Bot Aktif: ${client.user.tag}`);

    // Ses Kanalına 7/24 Girme İşlemi
    try {
        const guild = client.guilds.cache.first();
        if (guild) {
            const channel = await guild.channels.fetch(CONFIG.voiceChannelId);
            if (channel && channel.type === ChannelType.GuildVoice) {
                joinVoiceChannel({
                    channelId: channel.id,
                    guildId: guild.id,
                    adapterCreator: guild.voiceAdapterCreator,
                    selfDeaf: true,
                    selfMute: true
                });
                console.log(`[SES] 7/24 ses kanalına giriş yapıldı: ${channel.name}`);
            }
        }
    } catch (err) {
        console.error('Ses kanalına bağlanırken hata oluştu:', err);
    }
});

// Log gönderme fonksiyonu
async function sendLog(guild, description) {
    try {
        const logChannel = await guild.channels.fetch(CONFIG.logChannelId);
        if (logChannel) {
            await logChannel.send({ content: `🛡️ **GUARD LOG:**\n${description}` });
        }
    } catch (err) {
        console.error('Log gönderilemedi:', err);
    }
}

// 1. REKLAM VE SPAM KORUMASI
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const member = message.member;
    // Özel rolü olanlara veya yöneticilere dokunma
    if (member.roles.cache.has(CONFIG.bypassRoleId) || member.permissions.has(PermissionFlagsBits.Administrator)) {
        return;
    }

    // Reklam Koruması
    const inviteRegex = /(discord\.(gg|io|me|li)|discordapp\.com\/invite)\/[^\s]+/gi;
    if (inviteRegex.test(message.content)) {
        await message.delete().catch(() => {});
        const warn = await message.channel.send(`${message.author}, bu sunucuda reklam yapmak yasaktır!`);
        setTimeout(() => warn.delete().catch(() => {}), 5000);
        sendLog(message.guild, `${message.author.tag} (${message.author.id}) reklam yaptığı için mesajı silindi.`);
        return;
    }

    // Spam Koruması (Kısa sürede çok mesaj)
    const userId = message.author.id;
    const now = Date.now();
    if (!messageTracker.has(userId)) {
        messageTracker.set(userId, []);
    }

    const userTimestamps = messageTracker.get(userId);
    userTimestamps.push(now);

    // Son 5 saniyedeki mesajları filtrele
    const recentMessages = userTimestamps.filter(time => now - time < 5000);
    messageTracker.set(userId, recentMessages);

    // Eğer 5 saniyede 5'ten fazla mesaj atarsa spam say ve 1 saat zaman aşımı ver
    if (recentMessages.length >= 5) {
        messageTracker.delete(userId);
        try {
            await member.timeout(60 * 60 * 1000, 'Spam yaptığı için otomatik zaman aşımı.');
            await message.channel.send(`${message.author}, spam yaptığın için 1 saat süreyle susturuldun!`);
            sendLog(message.guild, `${message.author.tag} (${message.author.id}) spam yaptığı için **1 saat** zaman aşımı aldı.`);
        } catch (err) {
            console.error('Timeout verilemedi:', err);
        }
    }
});

// 2. KANAL SİLME KORUMASI & ÖZEL ROLÜ KORUMA
client.on('channelDelete', async (channel) => {
    const auditLogs = await channel.guild.fetchAuditLogs({
        limit: 1,
        type: AuditLogEvent.ChannelDelete,
    });
    const entry = auditLogs.entries.first();
    if (!entry) return;

    const { executor } = entry;
    if (executor.id === client.user.id) return;

    const member = await channel.guild.members.fetch(executor.id).catch(() => null);
    if (!member) return;

    // Özel rolü varsa veya adminse işlem yapma
    if (member.roles.cache.has(CONFIG.bypassRoleId) || member.permissions.has(PermissionFlagsBits.Administrator)) {
        return;
    }

    // Kanalı izinsiz silen kişinin yetkilerini al
    await member.roles.set([]).catch(console.error);
    sendLog(channel.guild, `🚨 ${executor.tag} izinsiz kanal sildiği için tüm rolleri alındı! Kanal: **${channel.name}**`);
});

client.login(process.env.TOKEN);
