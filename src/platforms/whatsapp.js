const { shell } = require('electron')
const credentials = require('./credentials')

// WhatsApp isn't an API post — it opens WhatsApp Desktop with the caption
// pre-filled to your own chat, so you tap Send and copy it on your phone.
// Sending is manual, which keeps it off any automation ToS.
module.exports = {
  id: 'whatsapp',
  name: 'WhatsApp (text only)',
  isConfigured: () => credentials.forPlatform('whatsapp') !== null,
  post: async ({ meta, onProgress = () => {} }) => {
    const creds = credentials.forPlatform('whatsapp')
    if (!creds) throw new Error('Add your WhatsApp phone number in Settings first')

    // Deep link wants international digits only — no +, spaces or dashes
    const phone = creds.phone.replace(/\D/g, '')
    const text = [meta.title, meta.caption, meta.hashtags].filter(Boolean).join('\n\n')

    onProgress('opening WhatsApp…')
    await shell.openExternal(`whatsapp://send?phone=${phone}&text=${encodeURIComponent(text)}`)

    return { warning: 'Opened WhatsApp — press Send to deliver it to your phone' }
  }
}
