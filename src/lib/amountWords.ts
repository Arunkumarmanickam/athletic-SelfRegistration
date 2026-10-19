// Indian-numbering amount in words, shared by the on-screen receipt and the
// generated PDF so both always read the same.

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
]
const TENS = ['', 'Ten', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

export function underHundred(value: number): string {
  if (value < 20) return ONES[value]
  const tens = Math.floor(value / 10)
  const ones = value % 10
  return `${TENS[tens]}${ones ? ` ${ONES[ones]}` : ''}`
}

export function underThousand(value: number): string {
  const hundreds = Math.floor(value / 100)
  const rest = value % 100
  const parts: string[] = []
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`)
  if (rest) parts.push(underHundred(rest))
  return parts.join(' ')
}

/** 125000 -> "One Lakh Twenty Five Thousand". */
export function rupeesInWords(paise: number): string {
  const rupees = Math.floor(Math.abs(paise) / 100)
  if (rupees === 0) return 'Zero'
  let rest = rupees
  const parts: string[] = []
  const crore = Math.floor(rest / 10000000)
  rest %= 10000000
  const lakh = Math.floor(rest / 100000)
  rest %= 100000
  const thousand = Math.floor(rest / 1000)
  rest %= 1000
  if (crore) parts.push(`${underThousand(crore)} Crore`)
  if (lakh) parts.push(`${underThousand(lakh)} Lakh`)
  if (thousand) parts.push(`${underThousand(thousand)} Thousand`)
  if (rest) parts.push(underThousand(rest))
  return parts.join(' ')
}

export function amountInWords(paise: number): string {
  const paisePart = Math.abs(paise) % 100
  return `Rupees ${rupeesInWords(paise)}${paisePart ? ` and ${underHundred(paisePart)} Paise` : ''} only`
}
