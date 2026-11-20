// Bodies whose name is often borrowed by people who are not them: banks, the post,
// couriers, the state, payment apps, card companies, toll roads, utilities, health
// funds, and the big online services. Each is listed with the sites its real mail
// comes from. The inspector (inspector.ts) uses the list for one thing only: when a
// letter carries one of these names and comes from somewhere else, it says so.
//
// The list grows over time. A missing site costs one soft note on an honest letter
// ("the sender is known to me" puts it away for good); a missing body costs nothing.

export type KnownSender = {
  /** Names as they appear beside an address. Short ones ("max") count only when they are the whole name. */
  names: string[]
  /** The sites their mail really comes from (any address under them counts). */
  domains: string[]
  /** The site's name is unlike any ordinary word, so a near-copy of it ("paypa1") is a sign of imitation. */
  distinct?: boolean
}

export const KNOWN_SENDERS: KnownSender[] = [
  // Banks
  { names: ['בנק לאומי', 'לאומי', 'bank leumi', 'leumi'], domains: ['leumi.co.il', 'bankleumi.co.il'], distinct: true },
  { names: ['בנק הפועלים', 'הפועלים', 'bank hapoalim', 'hapoalim', 'poalim'], domains: ['bankhapoalim.co.il', 'bankhapoalim.com', 'poalim.co.il', 'poalim.biz'], distinct: true },
  { names: ['בנק דיסקונט', 'דיסקונט', 'discount bank', 'israel discount bank'], domains: ['discountbank.co.il', 'discount.co.il'], distinct: true },
  { names: ['בנק מזרחי טפחות', 'מזרחי טפחות', 'mizrahi tefahot', 'mizrahi-tefahot'], domains: ['mizrahi-tefahot.co.il', 'umtb.co.il'], distinct: true },
  { names: ['הבנק הבינלאומי', 'הבינלאומי', 'הבינלאומי הראשון', 'fibi', 'first international bank'], domains: ['fibi.co.il', 'fibi-online.co.il'] },
  { names: ['בנק יהב', 'bank yahav'], domains: ['bank-yahav.co.il'] },
  { names: ['בנק מרכנתיל', 'מרכנתיל דיסקונט', 'mercantile'], domains: ['mercantile.co.il'] },
  { names: ['וואן זירו', 'one zero', 'one zero bank'], domains: ['onezerobank.com'] },
  { names: ['פפר', 'pepper'], domains: ['pepper.co.il'] },

  // Card companies and payment apps
  { names: ['ישראכרט', 'isracard'], domains: ['isracard.co.il'], distinct: true },
  { names: ['מקס', 'max', 'מקס איט פיננסים', 'לאומי קארד'], domains: ['max.co.il'] },
  { names: ['כאל', 'cal', 'כרטיסי אשראי לישראל', 'ויזה כאל'], domains: ['cal-online.co.il'] },
  { names: ['ביט', 'bit', 'אפליקציית ביט'], domains: ['bitpay.co.il', 'bankhapoalim.co.il', 'poalim.co.il'] },
  { names: ['פייבוקס', 'paybox'], domains: ['payboxapp.com'], distinct: true },
  { names: ['paypal', 'פייפאל'], domains: ['paypal.com', 'paypal.co.il', 'paypal-communication.com'], distinct: true },

  // The post and couriers
  { names: ['דואר ישראל', 'israel post', 'חברת דואר ישראל'], domains: ['israelpost.co.il'], distinct: true },
  { names: ['dhl', 'dhl express', 'די אייץ׳ אל'], domains: ['dhl.com', 'dhl.co.il', 'dhl.de'] },
  { names: ['fedex', 'פדקס'], domains: ['fedex.com'], distinct: true },
  { names: ['ups', 'united parcel service'], domains: ['ups.com'] },
  { names: ["צ'יטה", 'צ׳יטה', 'צ׳יטה שליחויות', 'cheetah'], domains: ['chita-il.com'] },
  { names: ['hfd', 'אייץ׳ אף די'], domains: ['hfd.co.il'] },

  // The state
  { names: ['רשות המסים', 'רשות המסים בישראל', 'מס הכנסה', 'ביטוח לאומי', 'המוסד לביטוח לאומי', 'משרד התחבורה', 'משרד הבריאות', 'ממשל זמין', 'gov.il', 'רשות האוכלוסין וההגירה'], domains: ['gov.il'] },

  // Toll roads
  { names: ['כביש 6', 'כביש שש', 'דרך ארץ', 'kvish 6'], domains: ['kvish6.co.il'], distinct: true },
  { names: ['מנהרות הכרמל', 'carmel tunnels'], domains: ['carmeltunnels.co.il'] },
  { names: ['הנתיב המהיר', 'fast lane'], domains: ['fastlane.co.il'] },

  // Utilities and phone companies
  { names: ['חברת החשמל', 'חברת החשמל לישראל', 'israel electric'], domains: ['iec.co.il'] },
  { names: ['בזק', 'bezeq'], domains: ['bezeq.co.il', 'bezeqint.net'], distinct: true },
  { names: ['פרטנר', 'partner'], domains: ['partner.co.il'] },
  { names: ['סלקום', 'cellcom'], domains: ['cellcom.co.il'], distinct: true },
  { names: ['פלאפון', 'pelephone'], domains: ['pelephone.co.il'], distinct: true },
  { names: ['הוט', 'hot', 'הוט מובייל', 'hot mobile'], domains: ['hot.net.il', 'hotmobile.co.il'] },
  { names: ['yes', 'יס'], domains: ['yes.co.il'] },

  // Health funds
  { names: ['כללית', 'שירותי בריאות כללית', 'clalit'], domains: ['clalit.co.il', 'clalit.org.il'], distinct: true },
  { names: ['מכבי', 'מכבי שירותי בריאות', 'maccabi'], domains: ['maccabi4u.co.il', 'mac.org.il'] },
  { names: ['מאוחדת', 'קופת חולים מאוחדת', 'meuhedet'], domains: ['meuhedet.co.il'], distinct: true },
  { names: ['לאומית', 'לאומית שירותי בריאות', 'leumit'], domains: ['leumit.co.il'] },

  // Online services
  { names: ['google', 'גוגל', 'google accounts', 'the google account team', 'google security'], domains: ['google.com', 'googlemail.com', 'youtube.com', 'google.co.il'], distinct: true },
  { names: ['apple', 'אפל', 'apple id', 'icloud', 'apple support'], domains: ['apple.com', 'icloud.com'] },
  { names: ['microsoft', 'מיקרוסופט', 'microsoft account', 'microsoft account team', 'outlook'], domains: ['microsoft.com', 'outlook.com', 'live.com', 'office.com', 'microsoftonline.com', 'office365.com', 'microsoft365.com'], distinct: true },
  { names: ['amazon', 'אמזון', 'amazon.com'], domains: ['amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.it', 'amazon.es', 'amazon.ca', 'amazon.co.jp', 'primevideo.com', 'amazonpay.com', 'amazonaws.com'], distinct: true },
  { names: ['netflix', 'נטפליקס'], domains: ['netflix.com'], distinct: true },
  { names: ['facebook', 'פייסבוק', 'meta', 'instagram', 'אינסטגרם'], domains: ['facebookmail.com', 'facebook.com', 'meta.com', 'instagram.com', 'mail.instagram.com'], distinct: true },
  { names: ['whatsapp', 'ווטסאפ', 'וואטסאפ'], domains: ['whatsapp.com'], distinct: true },
  { names: ['aliexpress', 'אליאקספרס'], domains: ['aliexpress.com', 'alibaba.com'], distinct: true },
  { names: ['ebay', 'איביי'], domains: ['ebay.com'] },
]

/** The demo mailbox has a bank of its own, so the inspector has something to catch there. */
export const DEMO_KNOWN: KnownSender[] = [{ names: ['בנק הדוגמה'], domains: ['bank-dugma.example'], distinct: true }]
