import path from 'path';
import fs from 'fs';
import { settings } from 'src/config/settings';
import { WASocket } from '@whiskeysockets/baileys';

export async function helpCommand(
  sock: WASocket,
  chatId: string,
  channelLink: string,
) {
  const helpMessage = `
╔═══════════════════╗
   *🤖 ${settings.botName || 'HYPERBOT'}*  
   Version: *${settings.version || '1.0.0'}*
   by ${settings.botOwner || 'JIMEX'}
   YT : ${global.ytch}
╚═══════════════════╝

*Available Commands:*

╔═══════════════════╗
🌐 *General Commands*:
║ ➤ .help or .menu
║ ➤ .tts <text>
║ ➤ .sticker or .s
║ ➤ .owner
║ ➤ .joke
║ ➤ .quote
║ ➤ .fact
║ ➤ .weather <city>
║ ➤ .news
║ ➤ .meme
║ ➤ .simage
║ ➤ .attp <text>
║ ➤ .lyrics <song_title>
║ ➤ .8ball <question>
╚═══════════════════╝

╔═══════════════════╗
🛠️ *Admin Commands*:
║ ➤ .ban @user
║ ➤ .promote @user
║ ➤ .demote @user
║ ➤ .mute <minutes>
║ ➤ .unmute
║ ➤ .delete or .del
║ ➤ .kick @user
║ ➤ .warnings @user
║ ➤ .warn @user
║ ➤ .antilink
║ ➤ .clear
║ ➤ .tag <message>
║ ➤ .tagall
╚═══════════════════╝

╔═══════════════════╗
🎮 *Game Commands*:
║ ➤ .tictactoe @user
║ ➤ .move <position>
║ ➤ .hangman
║ ➤ .guess <letter>
║ ➤ .trivia
║ ➤ .answer <answer>
║ ➤ .truth
║ ➤ .dare
╚═══════════════════╝

╔═══════════════════╗
🎯 *Fun Commands*:
║ ➤ .compliment @user
║ ➤ .insult @user
╚═══════════════════╝

Join our channel for updates:`;

  try {
    const imagePath = path.join(__dirname, '../assets/bot_image.jpg');

    if (fs.existsSync(imagePath)) {
      const imageBuffer = fs.readFileSync(imagePath);

      await sock.sendMessage(chatId, {
        image: imageBuffer,
        caption: helpMessage,
        contextInfo: {
          forwardingScore: 999,
          isForwarded: true,
          forwardedNewsletterMessageInfo: {
            newsletterJid: '120363161513685998@newsletter',
            newsletterName: 'HyperBot MD powered by JIMEX',
            serverMessageId: -1,
          },
          externalAdReply: {
            title: 'HYPERBOT MD',
            body: 'Menu',
            thumbnailUrl: 'https://i.imgur.com/trP1VbB.png',
            sourceUrl: channelLink,
            mediaType: 1,
            renderLargerThumbnail: true,
          },
        },
      });
    } else {
      console.error('Bot image not found at:', imagePath);
      await sock.sendMessage(chatId, {
        text: helpMessage,
        contextInfo: {
          forwardingScore: 999,
          isForwarded: true,
          forwardedNewsletterMessageInfo: {
            newsletterJid: '120363161513685998@newsletter',
            newsletterName: 'HyperBot MD powered by JIMEX',
            serverMessageId: -1,
          },
        },
      });
    }
  } catch (error) {
    console.error('Error in help command:', error);
    await sock.sendMessage(chatId, { text: helpMessage });
  }
}
