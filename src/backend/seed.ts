/**
 * Демо-данные магазина: товары, клиенты, заказы за полгода.
 *
 * Данные строятся ОТ «сегодня» и с фиксированным зерном: в любой день демо
 * выглядит живым (свежие заказы — сегодняшние), но при этом воспроизводимо.
 */
import type { Category, Customer, Delivery, Note, Order, OrderItem, OrderStatus, Payment, Product, ProductVariant, User } from '../shared/types.ts'
import { createRng, type Rng } from './rng.ts'

const DAY = 86_400_000

/** Демо-аккаунты для входа — по одному на роль. */
export const DEMO_USERS: User[] = [
  { id: 'u_admin', name: 'Дмитрий Рябов', email: 'admin@prilavok.demo', role: 'admin', hue: 152 },
  { id: 'u_manager', name: 'Алина Морозова', email: 'manager@prilavok.demo', role: 'manager', hue: 262 },
  { id: 'u_viewer', name: 'Гость', email: 'viewer@prilavok.demo', role: 'viewer', hue: 30 },
]

/** «Коллеги», которых изображает симулятор: смотрят заказы, пишут заметки. */
export const COLLEAGUES: User[] = [
  { id: 'u_c1', name: 'Тимур Гареев', email: 'timur@prilavok.demo', role: 'manager', hue: 205 },
  { id: 'u_c2', name: 'Вера Соколова', email: 'vera@prilavok.demo', role: 'manager', hue: 340 },
  { id: 'u_c3', name: 'Олег Ким', email: 'oleg@prilavok.demo', role: 'manager', hue: 90 },
]

type ProductSeed = [title: string, category: Category, price: number, variants?: string[]]

const PRODUCTS: ProductSeed[] = [
  ['Эфиопия Иргачеффе', 'coffee', 890, ['250 г', '1 кг']],
  ['Колумбия Супремо', 'coffee', 790, ['250 г', '1 кг']],
  ['Бразилия Сантос', 'coffee', 650, ['250 г', '1 кг']],
  ['Кения АА', 'coffee', 990, ['250 г', '1 кг']],
  ['Гватемала Антигуа', 'coffee', 840, ['250 г', '1 кг']],
  ['Эспрессо-смесь «Утро»', 'coffee', 690, ['250 г', '1 кг']],
  ['Эспрессо-смесь «Бархат»', 'coffee', 740, ['250 г', '1 кг']],
  ['Декаф Колумбия', 'coffee', 870, ['250 г']],
  ['Коста-Рика Тарразу', 'coffee', 920, ['250 г', '1 кг']],
  ['Руанда Ньямашеке', 'coffee', 960, ['250 г']],
  ['Дрип-пакеты «Ассорти», 10 шт', 'coffee', 590],
  ['Капсулы «Интенсо», 10 шт', 'coffee', 490],
  ['Сенча', 'tea', 540, ['50 г', '100 г']],
  ['Молочный улун', 'tea', 620, ['50 г', '100 г']],
  ['Да Хун Пао', 'tea', 880, ['50 г', '100 г']],
  ['Эрл Грей', 'tea', 460, ['50 г', '100 г']],
  ['Ассам', 'tea', 420, ['50 г', '100 г']],
  ['Пуэр шу, блин 100 г', 'tea', 1290],
  ['Жасминовый жемчуг', 'tea', 760, ['50 г', '100 г']],
  ['Матча церемониальная, 30 г', 'tea', 1490],
  ['Иван-чай с чабрецом', 'tea', 390, ['50 г', '100 г']],
  ['Ройбуш ванильный', 'tea', 410, ['50 г', '100 г']],
  ['Воронка V60', 'gear', 1450, ['пластик', 'керамика']],
  ['Фильтры для V60, 100 шт', 'gear', 520],
  ['Аэропресс', 'gear', 4290],
  ['Френч-пресс 600 мл', 'gear', 2190],
  ['Кемекс на 6 чашек', 'gear', 5490],
  ['Ручная кофемолка', 'gear', 6900],
  ['Чайник с «гусиной шеей»', 'gear', 4790],
  ['Весы с таймером', 'gear', 2890],
  ['Питчер 350 мл', 'gear', 1190],
  ['Темпер 58 мм', 'gear', 2490],
  ['Гайвань 120 мл', 'gear', 990],
  ['Термокружка 350 мл', 'gear', 1890, ['чёрная', 'мятная', 'песочная']],
  ['Кружка керамическая 300 мл', 'gear', 890, ['белая', 'графит']],
  ['Венчик для матчи', 'gear', 1090],
  ['Шоколад 70 %, 80 г', 'sweets', 390],
  ['Шоколад молочный с фундуком', 'sweets', 360],
  ['Печенье кантуччи, 200 г', 'sweets', 320],
  ['Кофейные зёрна в шоколаде', 'sweets', 450],
  ['Сироп «Солёная карамель»', 'sweets', 540],
  ['Сироп «Лесной орех»', 'sweets', 540],
  ['Мёд гречишный, 250 г', 'sweets', 480],
  ['Пастила яблочная', 'sweets', 290],
]

const FIRST_M = [
  'Александр',
  'Дмитрий',
  'Максим',
  'Сергей',
  'Андрей',
  'Алексей',
  'Артём',
  'Илья',
  'Кирилл',
  'Михаил',
  'Никита',
  'Матвей',
  'Роман',
  'Егор',
  'Иван',
  'Тимур',
  'Владимир',
  'Павел',
  'Глеб',
  'Денис',
]
const FIRST_F = [
  'Анна',
  'Мария',
  'Елена',
  'Ольга',
  'Наталья',
  'Екатерина',
  'Татьяна',
  'Ирина',
  'Светлана',
  'Юлия',
  'Дарья',
  'Алина',
  'Полина',
  'Виктория',
  'Ксения',
  'София',
  'Вера',
  'Алиса',
  'Диана',
  'Марина',
]
const LAST = [
  'Иванов',
  'Смирнов',
  'Кузнецов',
  'Попов',
  'Васильев',
  'Петров',
  'Соколов',
  'Михайлов',
  'Новиков',
  'Фёдоров',
  'Морозов',
  'Волков',
  'Алексеев',
  'Лебедев',
  'Семёнов',
  'Егоров',
  'Павлов',
  'Козлов',
  'Степанов',
  'Николаев',
  'Орлов',
  'Андреев',
  'Макаров',
  'Никитин',
  'Захаров',
  'Зайцев',
  'Соловьёв',
  'Борисов',
  'Яковлев',
  'Григорьев',
  'Романов',
  'Воробьёв',
  'Сергеев',
  'Кузьмин',
  'Фролов',
  'Александров',
  'Дмитриев',
  'Королёв',
  'Гусев',
  'Киселёв',
]
const CITIES = [
  'Москва',
  'Санкт-Петербург',
  'Новосибирск',
  'Екатеринбург',
  'Казань',
  'Нижний Новгород',
  'Челябинск',
  'Самара',
  'Уфа',
  'Ростов-на-Дону',
  'Краснодар',
  'Пермь',
  'Воронеж',
  'Волгоград',
  'Тюмень',
  'Калининград',
  'Псков',
  'Владивосток',
]
const NOTES = [
  'Клиент просил позвонить за час до доставки',
  'Упаковать как подарок',
  'Заменили помол на «под фильтр» по просьбе клиента',
  'Курьер подтвердил адрес',
  'Ждём поступление, клиент согласен подождать',
  'Добавили пробник в подарок',
  'Оплата прошла со второй попытки',
  'Клиент постоянный — проверить бонусы',
]

const DESCRIPTIONS: Record<Category, string[]> = {
  coffee: [
    'Свежая обжарка: жарим дважды в неделю небольшими партиями.',
    'Сбалансированный вкус, подходит и для эспрессо, и для фильтра.',
    'Яркая кислотность и долгое сладкое послевкусие.',
  ],
  tea: [
    'Листовой чай последнего урожая, хранится в герметичной упаковке.',
    'Мягкий вкус без горечи, выдерживает три-четыре заваривания.',
    'Собран вручную, подходит для заваривания проливом.',
  ],
  gear: ['Проверенная классика для домашнего заваривания.', 'Надёжные материалы, легко моется.', 'Компактный размер — удобно брать в поездки.'],
  sweets: ['Хорошо дополняет чёрный кофе.', 'Без искусственных ароматизаторов.', 'Небольшая партия от локального производителя.'],
}

const LATIN: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'c',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
}
const translit = (text: string) =>
  text
    .toLowerCase()
    .split('')
    .map((ch) => LATIN[ch] ?? ch)
    .join('')

export const startOfDay = (time: number) => {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** Ключ дня по местному календарю: 'YYYY-MM-DD'. */
export const dayKey = (time: number) => {
  const d = new Date(time)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function makeProducts(rng: Rng, now: number): Product[] {
  return PRODUCTS.map(([title, category, price, variantNames], i) => {
    const variants: ProductVariant[] = (variantNames ?? []).map((name, v) => ({
      name,
      // «1 кг» дороже «250 г» примерно в 3,6 раза; остальные варианты — небольшая надбавка
      priceDelta: name === '1 кг' ? Math.round((price * 2.6) / 10) * 10 : name === '100 г' ? Math.round((price * 0.9) / 10) * 10 : v * 200,
      stock: rng.chance(0.08) ? 0 : rng.int(3, 80),
    }))
    const ownStock = rng.chance(0.07) ? 0 : rng.chance(0.15) ? rng.int(1, 5) : rng.int(8, 140)
    const created = now - rng.int(30, 700) * DAY
    return {
      id: `p_${i + 1}`,
      title,
      sku: `${category.slice(0, 2).toUpperCase()}-${String(1000 + i * 7)}`,
      category,
      price,
      oldPrice: rng.chance(0.2) ? Math.round((price * 1.2) / 10) * 10 : null,
      stock: variants.length ? variants.reduce((sum, v) => sum + v.stock, 0) : ownStock,
      status: rng.chance(0.08) ? 'draft' : rng.chance(0.05) ? 'archived' : 'active',
      description: rng.pick(DESCRIPTIONS[category]),
      variants,
      sold: 0,
      createdAt: new Date(created).toISOString(),
      updatedAt: new Date(created + rng.int(0, 20) * DAY).toISOString(),
    }
  })
}

export const CUSTOMERS_COUNT = 10_000

function makeCustomers(rng: Rng, now: number): Customer[] {
  const customers: Customer[] = []
  for (let i = 0; i < CUSTOMERS_COUNT; i++) {
    const female = rng.chance(0.55)
    const first = rng.pick(female ? FIRST_F : FIRST_M)
    const last = rng.pick(LAST) + (female ? 'а' : '')
    // Большинство купили 1–2 раза, немногие — много: так устроены настоящие продажи.
    const r = rng.next()
    const ordersCount = r < 0.45 ? 1 : r < 0.75 ? rng.int(2, 4) : r < 0.95 ? rng.int(5, 12) : rng.int(13, 48)
    const totalSpent = ordersCount * rng.int(900, 4200)
    customers.push({
      id: `c_${i + 1}`,
      name: `${first} ${last}`,
      email: `${translit(first)}.${translit(last)}${i % 97}@example.com`,
      phone: `+7 9${rng.int(10, 99)} ${rng.int(100, 999)}-${rng.int(10, 99)}-${rng.int(10, 99)}`,
      city: rng.pick(CITIES),
      segment: totalSpent > 60_000 ? 'vip' : ordersCount > 1 ? 'regular' : 'new',
      ordersCount,
      totalSpent,
      registeredAt: new Date(now - rng.int(0, 900) * DAY - rng.int(0, DAY)).toISOString(),
    })
  }
  return customers
}

/** Состав заказа: 1–4 позиции из активных товаров. */
export function makeItems(rng: Rng, products: Product[]): OrderItem[] {
  const active = products.filter((p) => p.status === 'active')
  const count = rng.chance(0.5) ? 1 : rng.chance(0.6) ? 2 : rng.int(3, 4)
  const items: OrderItem[] = []
  for (let i = 0; i < count; i++) {
    const product = rng.pick(active)
    if (items.some((item) => item.productId === product.id)) continue
    const variant = product.variants.length ? rng.pick(product.variants) : null
    items.push({
      productId: product.id,
      title: variant ? `${product.title}, ${variant.name}` : product.title,
      price: product.price + (variant?.priceDelta ?? 0),
      qty: rng.chance(0.75) ? 1 : rng.int(2, 3),
    })
  }
  return items
}

export const sumItems = (items: OrderItem[]) => items.reduce((sum, item) => sum + item.price * item.qty, 0)

const DELIVERY_POOL: Delivery[] = ['courier', 'courier', 'pickup', 'post', 'post']
const PAYMENT_POOL: Payment[] = ['card', 'card', 'card', 'sbp', 'sbp', 'cash']

/** Статус по возрасту заказа: старые в основном доставлены, свежие — в работе. */
function statusByAge(rng: Rng, ageDays: number): OrderStatus {
  if (rng.chance(0.07)) return 'cancelled'
  if (ageDays > 6) return 'delivered'
  if (ageDays > 3) return rng.chance(0.7) ? 'delivered' : 'shipped'
  if (ageDays > 1) return rng.pick<OrderStatus>(['shipped', 'shipped', 'packing', 'paid'])
  return rng.pick<OrderStatus>(['new', 'new', 'paid', 'paid', 'packing'])
}

/** Правдоподобный путь заказа до его статуса — для ленты истории. */
function makeHistory(rng: Rng, created: number, status: OrderStatus, now: number) {
  const path: OrderStatus[] =
    status === 'cancelled'
      ? ['new', 'cancelled']
      : (['new', 'paid', 'packing', 'shipped', 'delivered'] as const).slice(0, ['new', 'paid', 'packing', 'shipped', 'delivered'].indexOf(status) + 1)
  let at = created
  return path.map((step, i) => {
    if (i > 0) at = Math.min(now, at + rng.int(20, 60 * 18) * 60_000)
    return { at: new Date(at).toISOString(), status: step, by: i === 0 ? 'Сайт' : rng.pick(['Система', ...COLLEAGUES.map((c) => c.name)]) }
  })
}

export const HISTORY_DAYS = 180

function makeOrders(rng: Rng, now: number, products: Product[], customers: Customer[]) {
  const today = startOfDay(now)
  const orders: Order[] = []
  let number = 10_000
  for (let ago = HISTORY_DAYS - 1; ago >= 0; ago--) {
    const dayStart = today - ago * DAY
    const weekday = new Date(dayStart).getDay()
    // Лёгкий рост к сегодняшнему дню + больше заказов в выходные.
    const base = 6 + ((HISTORY_DAYS - ago) / HISTORY_DAYS) * 6
    const count = Math.round(base * (weekday === 0 || weekday === 6 ? 1.35 : 1) * (0.7 + rng.next() * 0.6))
    const moments: number[] = []
    for (let i = 0; i < count; i++) {
      // Заказы чаще днём и вечером: два случайных числа дают «горб» в середине.
      const hour = 8 + (rng.next() + rng.next()) * 7.5
      const at = dayStart + Math.floor(hour * 3_600_000)
      if (at < now - 60_000) moments.push(at)
    }
    moments.sort((a, b) => a - b)
    for (const at of moments) {
      const customer = customers[rng.int(0, 2400)]!
      const items = makeItems(rng, products)
      if (!items.length) continue
      const status = statusByAge(rng, (now - at) / DAY)
      const history = makeHistory(rng, at, status, now)
      number++
      orders.push({
        id: `o_${number}`,
        number: `П-${number}`,
        createdAt: new Date(at).toISOString(),
        updatedAt: history[history.length - 1]!.at,
        version: history.length,
        status,
        customerId: customer.id,
        customerName: customer.name,
        city: customer.city,
        delivery: rng.pick(DELIVERY_POOL),
        payment: rng.pick(PAYMENT_POOL),
        items,
        total: sumItems(items),
        history,
      })
    }
  }
  return { orders, lastNumber: number }
}

function makeNotes(rng: Rng, orders: Order[]): Note[] {
  const notes: Note[] = []
  for (const order of orders.slice(-120)) {
    if (!rng.chance(0.35)) continue
    const author = rng.pick(COLLEAGUES)
    notes.push({
      id: `n_${notes.length + 1}`,
      orderId: order.id,
      authorId: author.id,
      authorName: author.name,
      hue: author.hue,
      text: rng.pick(NOTES),
      at: new Date(Date.parse(order.createdAt) + rng.int(5, 90) * 60_000).toISOString(),
    })
  }
  return notes
}

export const NOTE_TEXTS = NOTES

export type SeedData = {
  products: Product[]
  customers: Customer[]
  orders: Order[]
  notes: Note[]
  lastOrderNumber: number
}

export function seed(now: number, seedValue = 20260101): SeedData {
  const rng = createRng(seedValue)
  const products = makeProducts(rng, now)
  const customers = makeCustomers(rng, now)
  const { orders, lastNumber } = makeOrders(rng, now, products, customers)
  // «Продано» у товара — из настоящих заказов, чтобы цифры на экранах сходились.
  const sold = new Map<string, number>()
  for (const order of orders) {
    if (order.status === 'cancelled') continue
    for (const item of order.items) sold.set(item.productId, (sold.get(item.productId) ?? 0) + item.qty)
  }
  for (const product of products) product.sold = sold.get(product.id) ?? 0
  return { products, customers, orders, notes: makeNotes(rng, orders), lastOrderNumber: lastNumber }
}
