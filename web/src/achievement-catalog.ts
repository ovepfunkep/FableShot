import { RANK_LABELS, STAGE_RANK_FORMATS, STAGE_RANK_LABELS } from './sport-ranks.ts';

export const ACHIEVEMENT_RARITY_ORDER = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'] as const;
export type AchievementRarity = typeof ACHIEVEMENT_RARITY_ORDER[number];

export const ACHIEVEMENT_RARITY_LABELS: Readonly<Record<AchievementRarity, string>> = {
  Common: 'Обычное',
  Uncommon: 'Необычное',
  Rare: 'Редкое',
  Epic: 'Эпическое',
  Legendary: 'Легендарное',
  Mythic: 'Мифическое',
};

export const ACHIEVEMENT_BOW_LABELS = {
  recurve: 'Классический',
  compound: 'Блочный',
  barebow: 'Баребоу',
  traditional: 'Традиционный',
  longbow: 'Лонгбоу',
} as const;
export type AchievementBowScope = keyof typeof ACHIEVEMENT_BOW_LABELS;
export type AchievementScope = 'global' | AchievementBowScope | `stage-v1:${string}`;

export type AchievementDefinition = Readonly<{
  id: string;
  title: string;
  flavor: string;
  description: string;
  family: string;
  rarity: AchievementRarity;
  target: number;
  categorySpecific: boolean;
  performanceFormat: boolean;
  priority: number;
}>;

const stageRankNames = [
  ["Пробник с характером", "Короткая версия. Качество уже серьёзное"],
  ["Три — уже аргумент", "Мишень хотела возразить, но аргументы остались в ней"],
  ["Серия, держи марку", "Первый — это теперь про качество"],
  ["Кандидат без собеседования", "Резюме короткое. Попадания убедительные"],
  ["Мастер короткого метра", "На полный фильм пока не заявляем. Этот эпизод хорош"],
  ["Коротко, на мировом", "Мировой темп поместился в одну серию. Удостоверение всё ещё отдельно"],
  ["Это был не трейлер", "Минимум тридцать стрел. Титры заслужены"],
  ["Повторить без монтажа", "Удачные кадры не выбирали. Засчитали весь раунд"],
  ["Первый, но не случайный", "Качество пережило весь раунд"],
  ["Кандидат без сокращений", "Каждая стрела в приложении к резюме"],
  ["Мастер полной версии", "На этот раз хороший эпизод длился весь раунд"],
  ["Мир подождёт, я достреляю", "Мировой средний. Все стрелы на месте"],
] as const;

export const STAGE_RANK_RULES: readonly AchievementDefinition[] = stageRankNames.map(([title, flavor], index) => {
  const series = index < 6;
  const tier = index % 6;
  return {
    id: `${series ? 'SNR' : 'RNR'}0${tier + 1}`, title, flavor,
    description: `Впервые завершите ${series ? 'полную серию от 3 стрел' : 'полный раунд от 30 стрел'} со средним уровня ${STAGE_RANK_LABELS[tier]} или выше.`,
    family: series ? 'rank.first-series' : 'rank.first-round',
    rarity: ACHIEVEMENT_RARITY_ORDER[tier], target: 1, categorySpecific: true, performanceFormat: false, priority: tier + 1,
  };
});

// Android's original runtime catalog, followed by React rules.
export const ACHIEVEMENT_CATALOG: readonly AchievementDefinition[] = [
  {
    id: "START01", title: "Начало пути",
    flavor: "Осторожно: «я только попробую» обычно начинается именно так",
    description: "Завершите первую тренировку хотя бы с одним выстрелом. Подходит и учёт количества стрел без очков.",
    family: "journey.sessions", rarity: 'Common', target: 1, priority: 1,
    categorySpecific: false, performanceFormat: false,
  },
  {
    id: "START05", title: "Это уже не разовая акция",
    flavor: "Пять тренировок. Фраза «случайно зашёл» больше не работает",
    description: "Завершите 5 тренировок хотя бы с одним выстрелом в каждой. Они не обязаны идти подряд; учёт количества стрел без очков тоже подходит.",
    family: "journey.sessions", rarity: 'Uncommon', target: 5, priority: 5,
    categorySpecific: false, performanceFormat: false,
  },
  {
    id: "START06", title: "Колчан одобряет",
    flavor: "Первая сотня. Колчан делает вид, что совсем не устал",
    description: "Запишите 100 выстрелов суммарно за все тренировки. Подходит и учёт количества стрел без очков.",
    family: "journey.volume", rarity: 'Common', target: 100, priority: 6,
    categorySpecific: false, performanceFormat: false,
  },
  {
    id: "START07", title: "Я только попробовать",
    flavor: "Пятьсот стрел спустя это звучит особенно убедительно",
    description: "Запишите 500 выстрелов суммарно за все тренировки. Подходит и учёт количества стрел без очков.",
    family: "journey.volume", rarity: 'Uncommon', target: 500, priority: 7,
    categorySpecific: false, performanceFormat: false,
  },
  {
    id: "START08", title: "Это уже франшиза",
    flavor: "У первой сотни появилось слишком много продолжений",
    description: "Запишите 1000 выстрелов суммарно за все тренировки. Подходит и учёт количества стрел без очков.",
    family: "journey.volume", rarity: 'Rare', target: 1000, priority: 8,
    categorySpecific: false, performanceFormat: false,
  },
  {
    id: "START09", title: "Продолжение следует",
    flavor: "Второй сезон заказан. Мишень пока не в курсе",
    description: "Завершите 20 тренировок хотя бы с одним выстрелом в каждой. Перерывы между занятиями не мешают; учёт количества стрел без очков тоже подходит.",
    family: "journey.sessions", rarity: 'Rare', target: 20, priority: 9,
    categorySpecific: false, performanceFormat: false,
  },
  {
    id: "START10", title: "Местный фольклор",
    flavor: "Тебя уже могут узнавать по звуку попадания",
    description: "Завершите 100 тренировок хотя бы с одним выстрелом в каждой. Ежедневная стрельба не требуется; учёт количества стрел без очков тоже подходит.",
    family: "journey.sessions", rarity: 'Epic', target: 100, priority: 10,
    categorySpecific: false, performanceFormat: false,
  },
  {
    id: "START02", title: "Десятка, мы знакомы?",
    flavor: "Знакомство вышло прямо в точку",
    description: "Сохраните первую десятку или X в полной зачётной серии на мишени с максимумом 10 очков за стрелу.",
    family: "hits.ten", rarity: 'Common', target: 1, priority: 2,
    categorySpecific: true, performanceFormat: false,
  },
  {
    id: "START03", title: "Мимо не проходили",
    flavor: "Все стрелы пришли по адресу. Даже без навигатора",
    description: "Сохраните полную зачётную серию минимум из 3 стрел без промахов: каждая стрела приносит очки.",
    family: "hits.no-miss", rarity: 'Common', target: 1, priority: 3,
    categorySpecific: true, performanceFormat: false,
  },
  {
    id: "HIT01", title: "Тройной эспрессо",
    flavor: "Три десятки. Бодрит даже без кофеина",
    description: "Сохраните полную серию из 3 стрел, каждая из которых попала в десятку или X.\n18 м · мишень 40 см.",
    family: "hits.ten", rarity: 'Uncommon', target: 1, priority: 1,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "HIT02", title: "Колчан единогласен",
    flavor: "Шесть голосов за десятку. Воздержавшихся нет",
    description: "Сохраните полную серию из 6 стрел, каждая из которых попала в десятку или X. Нужна одна серия из шести стрел.\n18 м · мишень 40 см.",
    family: "hits.ten", rarity: 'Rare', target: 1, priority: 2,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "HIT03", title: "X-фактор",
    flavor: "Ничего лишнего. Даже девятка не понадобилась",
    description: "Сохраните X в полной серии на мишени, где есть зона X.\n18 м · мишень 40 см.",
    family: "hits.x", rarity: 'Uncommon', target: 1, priority: 3,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "HIT04", title: "Три крестика — не партия в крестики",
    flavor: "Мишень пока не поняла, кто ходит следующим",
    description: "Сохраните полную серию из 3 стрел, все попадания — X.\n18 м · мишень 40 см.",
    family: "hits.x", rarity: 'Epic', target: 1, priority: 4,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "HIT05", title: "X-Men: полный состав",
    flavor: "Все шестеро с одной суперспособностью — попадать в X",
    description: "Сохраните полную серию из 6 стрел, все попадания — X.\n18 м · мишень 40 см.",
    family: "hits.x", rarity: 'Legendary', target: 1, priority: 5,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "HIT06", title: "Без права на филлер",
    flavor: "Три серии подряд. Ни одной проходной сцены",
    description: "Сохраните 3 полные серии подряд, все попадания — десятки или X. В них должно быть суммарно не меньше 9 стрел при одинаковых условиях.\n18 м · мишень 40 см.",
    family: "hits.ten", rarity: 'Rare', target: 1, priority: 6,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "HIT07", title: "Матрица дала сбой",
    flavor: "Пять идеальных серий. Мишень проверяет настройки сложности",
    description: "Сохраните 5 полных серий подряд, все попадания — десятки или X. В них должно быть суммарно не меньше 15 стрел при одинаковых условиях.\n18 м · мишень 40 см.",
    family: "hits.ten", rarity: 'Epic', target: 1, priority: 7,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "HIT08", title: "Режиссёрская версия",
    flavor: "Десять серий. Плохие дубли в эту версию не вошли",
    description: "Сохраните 10 полных серий подряд, все попадания — десятки или X. В них должно быть суммарно не меньше 30 стрел при одинаковых условиях.\n18 м · мишень 40 см.",
    family: "hits.ten", rarity: 'Legendary', target: 1, priority: 8,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "HIT09", title: "Жёлтая пресса",
    flavor: "Местные издания сообщают: жёлтому кругу сегодня досталось",
    description: "Завершите тренировку минимум на 30 стрел, попав в жёлтые зоны 9–10 не менее чем 80% стрел. Все зачётные серии должны быть полными, условия — одинаковыми.\n18 м · мишень 40 см.",
    family: "score.average", rarity: 'Rare', target: 1, priority: 9,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "HIT10", title: "Монтаж не найден",
    flavor: "Шестьдесят стрел. Проверили: плохих кадров действительно нет",
    description: "Завершите полное поддерживаемое упражнение на 60 стрел: каждое попадание — десятка или X. Все зачётные серии должны быть полными, условия — одинаковыми.\n18 м · мишень 40 см.",
    family: "hits.ten", rarity: 'Mythic', target: 1, priority: 10,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "SCORE01", title: "Половина царства",
    flavor: "Половину очков забрал. С мишенью пока договорились",
    description: "Завершите тренировку минимум на 30 стрел со средним не ниже 5,0 из 10. Все зачётные серии должны быть полными, условия — одинаковыми.\n18 м · мишень 40 см.",
    family: "score.average", rarity: 'Uncommon', target: 1, priority: 1,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "SCORE02", title: "Семь раз попал",
    flavor: "Отмерять можно реже. Попадать — как сейчас",
    description: "Завершите тренировку минимум на 30 стрел со средним не ниже 7,0 из 10. Все зачётные серии должны быть полными, условия — одинаковыми.\n18 м · мишень 40 см.",
    family: "score.average", rarity: 'Rare', target: 1, priority: 2,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "SCORE03", title: "Восьмёрка бесконечности",
    flavor: "Знак бесконечности пока лежит набок от впечатления",
    description: "Завершите тренировку минимум на 30 стрел со средним не ниже 8,0 из 10. Все зачётные серии должны быть полными, условия — одинаковыми.\n18 м · мишень 40 см.",
    family: "score.average", rarity: 'Rare', target: 1, priority: 3,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "SCORE04", title: "Почти неприлично метко",
    flavor: "Мишени есть что обсудить после твоего ухода",
    description: "Завершите тренировку минимум на 60 стрел со средним не ниже 9,0 из 10. Все зачётные серии должны быть полными, условия — одинаковыми.\n18 м · мишень 40 см.",
    family: "score.average", rarity: 'Epic', target: 1, priority: 4,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "SCORE05", title: "Мишень подаст жалобу",
    flavor: "Ей обещали кружок по интересам, а не такую меткость",
    description: "Завершите тренировку минимум на 60 стрел со средним не ниже 9,5 из 10. Все зачётные серии должны быть полными, условия — одинаковыми.\n18 м · мишень 40 см.",
    family: "score.average", rarity: 'Legendary', target: 1, priority: 5,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "SCORE06", title: "Промах взял отпуск",
    flavor: "И за всю тренировку так и не вышел на связь",
    description: "Завершите тренировку минимум на 30 стрел без промахов. Все зачётные серии должны быть полными, условия — одинаковыми.\n18 м · мишень 40 см.",
    family: "hits.no-miss", rarity: 'Rare', target: 1, priority: 6,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "GROUP01", title: "Стрелы спелись",
    flavor: "Решили держаться вместе. Вполне убедительный ансамбль",
    description: "Сохраните плотную группу в полной серии минимум из 3 стрел: средний разброс от центра группы (RMS) не больше 30 мм, средний балл не ниже 5. Все попадания отмечены на мишени.\n18 м · мишень 40 см.",
    family: "group", rarity: 'Uncommon', target: 1, priority: 1,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "GROUP02", title: "Коммуналка",
    flavor: "Всем тесно. Всем нравится",
    description: "Сохраните плотную группу в полной серии минимум из 3 стрел: средний разброс от центра группы (RMS) не больше 15 мм, средний балл не ниже 7. Все попадания отмечены на мишени.\n18 м · мишень 40 см.",
    family: "group", rarity: 'Rare', target: 1, priority: 2,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "GROUP03", title: "Личное пространство? Нет",
    flavor: "У стрел на этот вопрос своё мнение",
    description: "Сохраните плотную группу в полной серии минимум из 3 стрел: средний разброс от центра группы (RMS) не больше 8 мм, средний балл не ниже 8. Все попадания отмечены на мишени.\n18 м · мишень 40 см.",
    family: "group", rarity: 'Epic', target: 1, priority: 3,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "GROUP04", title: "Шесть в квартире-студии",
    flavor: "Почтальон благодарен за один компактный адрес",
    description: "Сохраните плотную группу в полной серии минимум из 6 стрел: средний разброс от центра группы (RMS) не больше 12 мм, средний балл не ниже 8. Все попадания отмечены на мишени.\n18 м · мишень 40 см.",
    family: "group", rarity: 'Legendary', target: 1, priority: 4,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "GROUP05", title: "Тесно, зато свои",
    flavor: "Эта компания приходит вместе подозрительно регулярно",
    description: "Закройте пять полных серий подряд в одинаковых условиях. Нужно минимум 15 стрел с координатами, кучность Q не ниже 0,50 в каждой серии и средний балл окна от 7.",
    family: "group", rarity: 'Rare', target: 1, priority: 5,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "GROUP06", title: "Адресом ошиблись",
    flavor: "Все вместе. Просто вечеринка оказалась не в центре",
    description: "Сохраните полную серию минимум из 3 стрел без промахов: средний разброс от центра группы (RMS) не больше 6 мм, а центр группы дальше 30 мм от центра мишени. Все попадания отмечены на мишени.\n18 м · мишень 40 см.",
    family: "group", rarity: 'Uncommon', target: 1, priority: 6,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "GROUP08", title: "Робин, только без счёта за стрелы",
    flavor: "Плотно. Очень плотно. Но расколотые стрелы мы не требуем",
    description: "Сохраните плотную группу в полной серии ровно из 3 стрел: средний разброс от центра группы (RMS) не больше 6 мм, средний балл не ниже 9. Все попадания отмечены на мишени.\n18 м · мишень 40 см.",
    family: "group", rarity: 'Legendary', target: 1, priority: 8,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "STEADY01", title: "Кажется, нащупал",
    flavor: "Тот самый момент, когда «повезло» уже не объяснение",
    description: "Завершите тренировку минимум из 10 полных серий и 30 стрел: стабильность CG3 не ниже 85%, средний балл не ниже 6. Условия одинаковы, учитывается вся тренировка.\n18 м · мишень 40 см.",
    family: "stability", rarity: 'Rare', target: 1, priority: 1,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "STEADY02", title: "День сурка. Хороший",
    flavor: "Опять хорошо. И опять хорошо. Можно ещё раз",
    description: "Сохраните 5 полных серий подряд с одинаковым числом стрел и одинаковой суммой очков. Вместе в них не меньше 15 стрел, средний балл не ниже 6, условия одинаковы.\n18 м · мишень 40 см.",
    family: "stability", rarity: 'Uncommon', target: 1, priority: 2,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "STEADY03", title: "Метроном попросил автограф",
    flavor: "Серии настолько ровные, что ему немного неловко",
    description: "Завершите тренировку минимум из 15 полных серий: стабильность CG3 не ниже 95%, средний балл не ниже 8. Условия одинаковы, учитывается вся тренировка.\n18 м · мишень 40 см.",
    family: "stability", rarity: 'Epic', target: 1, priority: 3,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "STEADY04", title: "Американские горки закрыты",
    flavor: "Сегодня результатам разрешили спокойно постоять на месте",
    description: "Завершите тренировку минимум из 10 полных серий. Средние баллы лучшей и худшей серии различаются не больше чем на 1 очко, общий средний не ниже 7. Условия одинаковы.\n18 м · мишень 40 см.",
    family: "stability", rarity: 'Rare', target: 1, priority: 4,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "STEADY05", title: "Поймал волну",
    flavor: "Сёрф без доски. Зато с очень хорошими сериями",
    description: "Последние 5 полных серий одной тренировки имеют стабильность CG3 не ниже 90% и средний балл не ниже 7. До них уже записаны первые 3 полные серии; условия одинаковы.\n18 м · мишень 40 см.",
    family: "stability", rarity: 'Uncommon', target: 1, priority: 5,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "STEADY06", title: "Сценарист передумал",
    flavor: "Начинали как драму. Закончили совсем другим жанром",
    description: "В одной тренировке средний балл последних 5 полных серий выше среднего первых 3 полных серий хотя бы на 1 очко. Стабильность последних пяти не ниже 90% по CG3, условия одинаковы. Промахи тоже учитываются.\n18 м · мишень 40 см.",
    family: "stability", rarity: 'Rare', target: 1, priority: 6,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "STEADY08", title: "Это уже не удача",
    flavor: "Увёз домой. Вернулся. Повторил. Ещё раз",
    description: "Завершите 3 тренировки со стабильностью CG3 не ниже 90% в каждой. В каждой минимум 8 полных серий; условия и комплект одинаковы во всех трёх тренировках. Перерывы между занятиями не мешают.\n18 м · мишень 40 см.",
    family: "stability", rarity: 'Epic', target: 1, priority: 8,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "RANK04", title: "Обезьяна с гранатой",
    flavor: "Точнее, уже с луком. И, между прочим, попадает",
    description: "В завершённом поддерживаемом упражнении наберите не меньше норматива III разряда для своей категории. Присвоенный разряд в профиле сохраняется отдельно.",
    family: "norms", rarity: 'Rare', target: 1, priority: 4,
    categorySpecific: true, performanceFormat: false,
  },
  {
    id: "RANK05", title: "Мерида бы кивнула",
    flavor: "Характер есть. Мишень подтверждает",
    description: "В завершённом поддерживаемом упражнении наберите не меньше норматива II разряда для своей категории. Присвоенный разряд в профиле сохраняется отдельно.",
    family: "norms", rarity: 'Rare', target: 1, priority: 5,
    categorySpecific: true, performanceFormat: false,
  },
  {
    id: "RANK06", title: "Кэтнисс, подвинься",
    flavor: "В районе появился ещё один очень убедительный лучник",
    description: "В завершённом поддерживаемом упражнении наберите не меньше норматива I разряда для своей категории. Присвоенный разряд в профиле сохраняется отдельно.",
    family: "norms", rarity: 'Epic', target: 1, priority: 6,
    categorySpecific: true, performanceFormat: false,
  },
  {
    id: "RANK07", title: "Леголас на минималках",
    flavor: "Минималки выглядят подозрительно серьёзно",
    description: "В завершённом поддерживаемом упражнении наберите не меньше норматива КМС для своей категории. Присвоенный разряд в профиле сохраняется отдельно.",
    family: "norms", rarity: 'Epic', target: 1, priority: 7,
    categorySpecific: true, performanceFormat: false,
  },
  {
    id: "RANK08", title: "Робин Гуд своего района",
    flavor: "Легенды обычно начинаются с чего-то такого",
    description: "В завершённом поддерживаемом упражнении наберите не меньше норматива МС для своей категории. Присвоенное звание в профиле сохраняется отдельно.",
    family: "norms", rarity: 'Legendary', target: 1, priority: 8,
    categorySpecific: true, performanceFormat: false,
  },
  {
    id: "RANK09", title: "Артемида одобряет",
    flavor: "Олимп просил передать: было красиво",
    description: "В завершённом поддерживаемом упражнении наберите не меньше норматива МСМК для своей категории. Присвоенное звание в профиле сохраняется отдельно.",
    family: "norms", rarity: 'Mythic', target: 1, priority: 9,
    categorySpecific: true, performanceFormat: false,
  },
  {
    id: "PROGRESS01", title: "Вчерашний я, извини",
    flavor: "Сегодня ты в личном протоколе чуть ниже",
    description: "Поднимите обычный средний минимум на 0,1 балла за стрелу. Нужна готовая база похожих тренировок и минимум 12 стрел в полных закрытых сериях.",
    family: "progress", rarity: 'Uncommon', target: 1, priority: 1,
    categorySpecific: true, performanceFormat: false,
  },
  {
    id: "PROGRESS02", title: "Прошлый я просит реванш",
    flavor: "Кажется, соперник начал воспринимать всё всерьёз",
    description: "Добавьте минимум 0,5 балла к обычному среднему за стрелу. Нужна готовая база похожих тренировок и минимум 12 стрел в полных закрытых сериях.",
    family: "progress", rarity: 'Rare', target: 1, priority: 2,
    categorySpecific: true, performanceFormat: false,
  },
  {
    id: "PROGRESS03", title: "Прошлая версия устарела",
    flavor: "Обновление установилось прямо в мишень",
    description: "Добавьте минимум 1 балл к обычному среднему за стрелу, внеся минимум 30 стрел в полных закрытых сериях при готовой базе похожих тренировок.",
    family: "progress", rarity: 'Epic', target: 1, priority: 3,
    categorySpecific: true, performanceFormat: false,
  },
  {
    id: "PROGRESS04", title: "Личный босс повержен",
    flavor: "На одного босса меньше. На один повод улыбнуться больше",
    description: "Побейте существующий личный рекорд полной серии: больше очков при том же числе стрел, условиях и комплекте. Первый результат и повтор рекорда не подходят. Прежняя и импортированная история может быть базой сравнения.",
    family: "records", rarity: 'Rare', target: 1, priority: 4,
    categorySpecific: true, performanceFormat: false,
  },
  {
    id: "PROGRESS06", title: "Старый рекорд уволен",
    flavor: "Без отработки. Спасибо за службу",
    description: "Побейте существующий личный рекорд полного поддерживаемого упражнения минимум на 30 стрел. Нужны тот же формат, число стрел, условия и комплект. Первый результат и повтор рекорда не подходят. Прежняя и импортированная история может быть базой сравнения.",
    family: "records", rarity: 'Epic', target: 1, priority: 6,
    categorySpecific: true, performanceFormat: false,
  },
  {
    id: "PROGRESS08", title: "Везение так долго не длится",
    flavor: "Три тренировки уже тянут на убедительное алиби",
    description: "Завершите три разные тренировки в сопоставимых условиях с положительным прогрессом PG1. Для каждой нужна готовая база сравнения.",
    family: "progress", rarity: 'Epic', target: 3, priority: 8,
    categorySpecific: true, performanceFormat: false,
  },
  {
    id: "PROGRESS10", title: "Ну наконец-то",
    flavor: "Рекорд продержался месяц. Держался как мог",
    description: "Побейте рекорд полной серии или поддерживаемого упражнения, который держался минимум календарный месяц с последнего улучшения. Нужны известная дата рекорда, тот же формат, число стрел, условия и комплект. Прежняя и импортированная история может быть базой сравнения.",
    family: "records", rarity: 'Rare', target: 1, priority: 10,
    categorySpecific: true, performanceFormat: false,
  },
  {
    id: "STORY01", title: "Финальные титры в золоте",
    flavor: "Последняя серия такая, что хочется пересмотреть",
    description: "Завершите тренировку полной серией, в которой все стрелы попали в десятку. До неё должно быть ещё минимум пять полных зачётных серий.",
    family: "story.finish", rarity: 'Rare', target: 1, priority: 1,
    categorySpecific: true, performanceFormat: true,
  },
  {
    id: "GEAR02", title: "Самурай одного лука",
    flavor: "С рукояткой уже можно здороваться без представлений",
    description: "Завершите 10 непустых тренировок с одним и тем же луком. Переименование лука сохраняет прогресс.",
    family: "gear.loyalty", rarity: 'Rare', target: 10, priority: 2,
    categorySpecific: false, performanceFormat: false,
  },
  {
    id: "GEAR03", title: "Гастроли по дистанциям",
    flavor: "Мишень переехала. Ты остался убедительным",
    description: "Отстреляйте минимум 12 зачётных стрел подряд на каждой из трёх дистанций в завершённых тренировках.",
    family: "gear.distance", rarity: 'Uncommon', target: 3, priority: 3,
    categorySpecific: false, performanceFormat: false,
  },
  {
    id: "GEAR06", title: "Вместе состаримся",
    flavor: "Пятьдесят тренировок — это уже отношения",
    description: "Завершите 50 непустых тренировок с одним и тем же комплектом. Переименование комплекта сохраняет прогресс.",
    family: "gear.loyalty", rarity: 'Rare', target: 50, priority: 6,
    categorySpecific: false, performanceFormat: false,
  },
  {
    id: "MIND03", title: "Гэндальф записал",
    flavor: "Теперь «ты не пройдёшь» относится только к забытым подсказкам",
    description: "Опубликуйте свою первую памятку с описанием или шагами техники.",
    family: "technique.publication", rarity: 'Common', target: 1, priority: 3,
    categorySpecific: false, performanceFormat: false,
  },
  {
    id: "MIND04", title: "Режиссёрские правки",
    flavor: "Первая версия была хороша. Пока не появилась эта",
    description: "Опубликуйте две версии одной своей памятки с разным содержанием.",
    family: "technique.publication", rarity: 'Uncommon', target: 1, priority: 4,
    categorySpecific: false, performanceFormat: false,
  },
  {
    id: "APP01", title: "Правильный выбор",
    flavor: "Стрелы переехали. Мишени можно оставить на месте",
    description: "Успешно перенесите данные из MyTargets, добавив хотя бы одну новую тренировку или стрелу. Файл из одних дублей, отмена и ошибка не считаются переносом. Импорт не даёт спортивных достижений и не увеличивает их прогресс.",
    family: "import", rarity: 'Common', target: 1, priority: 1,
    categorySpecific: false, performanceFormat: false,
  },
  {
    id: "APP04", title: "В рамку",
    flavor: "Маме можно показать. В чат лучников — тоже",
    description: "Создайте PNG-карточку своей непустой тренировки. Отправлять её кому-либо не обязательно.",
    family: "share", rarity: 'Common', target: 1, priority: 4,
    categorySpecific: false, performanceFormat: false,
  },
  {
    id: "APP08", title: "У героя есть имя",
    flavor: "Даже если это Пельмень 3000",
    description: "Сохраните непустое имя профиля. Можно выбрать любое имя или псевдоним; завершать тренировку не нужно. Уже сохранённое имя само по себе не выдаёт знак.",
    family: "profile", rarity: 'Common', target: 1, priority: 8,
    categorySpecific: false, performanceFormat: false,
  },
  {
    id: "MIND08", title: "Передам по наследству",
    flavor: "История переживёт больше одного телефона",
    description: "Создайте и сохраните полный архив своего дневника. Приложение должно успешно проверить архив; восстановление готового архива само по себе не выдаёт знак.",
    family: "archive", rarity: 'Uncommon', target: 1, priority: 8,
    categorySpecific: false, performanceFormat: false,
  },
  ...STAGE_RANK_RULES,
];

const definitionsById = new Map(ACHIEVEMENT_CATALOG.map(rule => [rule.id, rule]));
const bowScopes = Object.keys(ACHIEVEMENT_BOW_LABELS) as AchievementBowScope[];
const rankScopes = ['recurve', 'compound', 'barebow'] as const;

export function getAchievementDefinition(id: string): AchievementDefinition | undefined {
  return definitionsById.get(id);
}

export function achievementScopesFor(rule: AchievementDefinition): readonly AchievementScope[] {
  if (isStageRankRule(rule.id)) {
    const label = STAGE_RANK_LABELS[rule.priority - 1];
    return STAGE_RANK_FORMATS.filter(format => !(format.bow === 'barebow' && format.distance === 18 && format.arrows === 30) &&
      format.thresholds[RANK_LABELS.indexOf(label)] != null)
      .map(format => format.scope as AchievementScope);
  }
  if (!rule.categorySpecific) return ['global'];
  if (rule.id.startsWith('RANK') || rule.id === 'PROGRESS06') return rankScopes;
  return bowScopes;
}

export function isStageRankRule(id: string): boolean {
  return /^(SNR|RNR)0[1-6]$/.test(id);
}

export function achievementScopeBow(scope: AchievementScope): 'global' | AchievementBowScope {
  const format = STAGE_RANK_FORMATS.find(item => item.scope === scope);
  return format?.bow ?? (scope as 'global' | AchievementBowScope);
}

export function achievementScopeLabel(scope: string): string {
  if (scope === 'global') return 'Общее';
  const format = STAGE_RANK_FORMATS.find(item => item.scope === scope);
  if (!format) return ACHIEVEMENT_BOW_LABELS[scope as AchievementBowScope] ?? scope;
  const bowClass = { recurve: 'КЛ', compound: 'БЛ', barebow: 'КЛб' }[format.bow];
  const target = format.target === 'wa-outdoor-six-v1' ? ' · 6 зон' : '';
  return `${bowClass}(${format.category === 'male' ? 'М' : 'Ж'}) · ${format.distance} м / ${format.diameter / 10} см${target} · формат ${format.arrows} стрел`;
}

const compoundFormatRarity = ['Common', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'] as const;
const barebowAndTraditionalFormatRarity = ['Common', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Mythic'] as const;

export function achievementRarityFor(rule: AchievementDefinition, scope: string): AchievementRarity {
  if (!rule.performanceFormat) return rule.rarity;
  const index = ACHIEVEMENT_RARITY_ORDER.indexOf(rule.rarity);
  if (scope === 'compound') return compoundFormatRarity[index];
  if (scope === 'barebow' || scope === 'traditional' || scope === 'longbow') return barebowAndTraditionalFormatRarity[index];
  return rule.rarity;
}

export function achievementTierOrder(rule: Pick<AchievementDefinition, 'id' | 'priority'>): number {
  return rule.id === 'START02' ? 0 : rule.priority;
}
