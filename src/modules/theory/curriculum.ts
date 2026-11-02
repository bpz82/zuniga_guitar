/**
 * The theory and physics curriculum (Blake, 2026-11-02). One course built
 * from both books, taught lesson by lesson from absolute basics:
 *   - Benade, Fundamentals of Musical Acoustics (Dover, 2nd rev. ed. 1990)
 *   - Winer, The Audio Expert, 2nd ed. (Routledge, 2018)
 * It replaces the 2026-10-31 topic deck's book cards (deck.ts, kept and
 * marked superseded; their history stays in the log).
 *
 * Rules the content follows:
 *   - Assume no prior knowledge. Every term is defined in a lesson's reading
 *     (or an earlier lesson's) before a card uses it.
 *   - Each lesson builds on the ones before; lessons unlock one at a time
 *     (the graduation rule is in practice.ts).
 *   - Copyright: every word is our own, about facts. Nothing is quoted or
 *     paraphrased line by line from either book and no figure is reproduced.
 *     Each card keeps a citation (book and chapter, or "general") as data
 *     for checking facts; the app never shows it (Blake, 2026-11-02).
 *
 * Content lives in code, not in the log: the log keeps only each card's id
 * and lesson number, so a corrected card reaches every device with the app.
 */
import type { Source } from './deck.ts';

export interface LessonQa {
  readonly id: string;
  readonly lesson: number;
  readonly type: 'qa';
  readonly question: string;
  readonly answer: string;
  readonly source: Source;
}
export interface LessonMc {
  readonly id: string;
  readonly lesson: number;
  readonly type: 'mc';
  readonly question: string;
  readonly answer: string;
  /** Three wrong but plausible options. */
  readonly wrong: readonly [string, string, string];
  /** Shown after answering. */
  readonly why: string;
  readonly source: Source;
}
export type LessonCard = LessonQa | LessonMc;

export interface Lesson {
  /** 1, 2, 3... in teaching order. */
  readonly n: number;
  readonly chapter: number;
  readonly title: string;
  /** The reading: short paragraphs, shown before and alongside the lesson's cards. */
  readonly reading: readonly string[];
  readonly cards: readonly LessonCard[];
}

export const CURRICULUM_CHAPTERS: Readonly<Record<number, string>> = {
  1: 'Sound itself',
  2: 'Musical tones',
  3: 'The guitar string',
  4: 'Bodies, ears and rooms',
  5: 'Recording and sound engineering',
};

const B = (chapter: number): Source => ({ book: 'benade', chapter });
const W = (chapter: number): Source => ({ book: 'winer', chapter });
const G = (note: string): Source => ({ book: 'general', note });

type Draft = { readonly type: 'qa'; readonly slug: string; readonly question: string; readonly answer: string; readonly source: Source } | { readonly type: 'mc'; readonly slug: string; readonly question: string; readonly answer: string; readonly wrong: readonly [string, string, string]; readonly why: string; readonly source: Source };
const qa = (slug: string, question: string, answer: string, source: Source): Draft => ({ type: 'qa', slug, question, answer, source });
const mc = (slug: string, question: string, answer: string, wrong: [string, string, string], why: string, source: Source): Draft => ({ type: 'mc', slug, question, answer, wrong, why, source });

/** Card ids: "l01-what-is-sound". The engine's ids add a prefix and suffix (practice.ts). */
export const lessonCardId = (n: number, slug: string) => `l${String(n).padStart(2, '0')}-${slug}`;

function lesson(n: number, chapter: number, title: string, reading: string[], drafts: Draft[]): Lesson {
  const cards = drafts.map((d): LessonCard => {
    const id = lessonCardId(n, d.slug);
    return d.type === 'qa'
      ? { id, lesson: n, type: 'qa', question: d.question, answer: d.answer, source: d.source }
      : { id, lesson: n, type: 'mc', question: d.question, answer: d.answer, wrong: d.wrong, why: d.why, source: d.source };
  });
  return { n, chapter, title, reading, cards };
}

export const LESSONS: readonly Lesson[] = Object.freeze([
  // ======================================================= Chapter 1: Sound itself
  lesson(1, 1, 'What sound is', [
    'Sound is a vibration that travels. Something moves back and forth (a guitar string, a speaker, your vocal cords) and pushes on the air next to it. That air pushes on the air beside it, and so on, until the push reaches your ear.',
    'The air itself does not travel from the guitar to you. Each bit of air only jiggles in place: squeezed a tiny bit closer together (higher pressure, called compression), then pulled a tiny bit farther apart (lower pressure, called rarefaction). What travels is the pattern of pressure changes. That travelling pattern is a sound wave.',
    'Sound needs something to travel through: air, water, wood or steel. This is called the medium. In empty space there is nothing to push on, so there is no sound.',
    'In air at room temperature sound travels about 343 metres per second (about 1,125 feet per second). That is roughly one foot per millisecond; a millisecond (ms) is a thousandth of a second. Sound travels faster through water, and faster still through solids such as wood and steel.',
    'Your ear works the other way round: the pressure changes push your eardrum in and out, and your inner ear turns that motion into signals for your brain.',
  ], [
    qa('what-is-sound', 'In one sentence, what is sound?', 'A vibration that travels through a medium such as air, as a pattern of tiny pressure changes.', B(1)),
    mc('what-travels', 'You strum a guitar across the room. What actually travels from the guitar to your ear?', 'A pattern of pressure changes; the air itself only jiggles in place', ['The air near the guitar flows over to your ear', 'Tiny particles thrown off by the string', 'Electricity through the air'], 'Each bit of air moves back and forth a tiny amount and passes the push on. The pattern travels; the air stays put.', B(2)),
    qa('compression', 'What are compression and rarefaction?', 'Compression: air squeezed slightly closer together (higher pressure). Rarefaction: air pulled slightly farther apart (lower pressure). A sound wave is the two alternating.', W(1)),
    mc('space', 'Why is there no sound in outer space?', 'There is no medium to carry the vibration', ['It is too cold for sound', 'Sound travels too fast there to hear', 'Starlight drowns it out'], 'Sound is a pressure pattern in a medium; with nothing to push on, nothing can travel.', B(1)),
    mc('speed', 'About how fast does sound travel in air at room temperature?', 'About 343 metres (1,125 feet) per second', ['About 34 metres per second', 'About 3,400 metres per second', 'Instantly'], 'Fast, but slow enough to measure: about a foot every millisecond.', W(1)),
    qa('foot-per-ms', 'Roughly how far does sound travel in air in one millisecond?', 'About a foot (34 cm). A sound 10 feet away reaches you about 10 ms after it starts.', W(19)),
    mc('solids', 'Compared with air, sound travels through wood and steel…', 'Faster', ['Slower', 'At the same speed', 'Not at all'], 'Stiff solids pass a push along much more quickly than air does.', B(1)),
    qa('eardrum', 'What does your eardrum do with a sound wave?', 'The pressure changes push it in and out, and the inner ear turns that motion into signals for the brain.', W(3)),
  ]),
  lesson(2, 1, 'Frequency, period and pitch', [
    'A vibration repeats. One complete back-and-forth movement (out, back, and out again to where it started) is called a cycle.',
    'Frequency is how many cycles happen each second. Its unit is the hertz (Hz): 1 Hz is one cycle per second. 1,000 Hz is written 1 kHz (kilohertz). The open A string of a guitar vibrates 110 times a second: 110 Hz.',
    'The period is the time one cycle takes. It is 1 divided by the frequency: a 100 Hz vibration has a period of 1/100 of a second, which is 10 milliseconds. Higher frequency means shorter period.',
    'Pitch is how high or low a note sounds to you. It is the ear\'s sense of frequency: faster vibration, higher pitch. Doubling the frequency raises the pitch by one octave, the same note name one step higher up. The A an octave above the open A string is 220 Hz.',
    'Young, healthy ears hear from about 20 Hz to about 20 kHz. The top end drops with age and with exposure to loud sound.',
  ], [
    qa('cycle', 'What is one cycle of a vibration?', 'One complete back-and-forth movement, ending where it started, ready to repeat.', B(3)),
    qa('frequency', 'What is frequency, and what is its unit?', 'How many cycles happen each second, measured in hertz (Hz). 1 Hz is one cycle per second.', W(1)),
    mc('khz', 'How many cycles per second is 2 kHz?', '2,000', ['200', '20', '20,000'], 'Kilo means a thousand: 2 kHz is 2,000 Hz.', W(1)),
    mc('period', 'What is the period of a 100 Hz vibration?', '10 milliseconds', ['100 milliseconds', '1 millisecond', '1 second'], 'Period = 1 ÷ frequency = 1/100 of a second = 10 ms.', B(3)),
    qa('period-rule', 'How are frequency and period related?', 'Period = 1 ÷ frequency. Higher frequency, shorter period: 1 kHz has a period of 1 ms.', B(3)),
    qa('pitch', 'What is pitch?', 'How high or low a sound seems: the ear\'s sense of its frequency. Faster vibration sounds higher.', B(5)),
    mc('octave', 'The open A string is 110 Hz. What frequency is the A one octave higher?', '220 Hz', ['120 Hz', '165 Hz', '440 Hz'], 'An octave up doubles the frequency.', B(5)),
    mc('hearing-range', 'Roughly what range of frequencies can young, healthy ears hear?', '20 Hz to 20 kHz', ['200 Hz to 2 kHz', '2 Hz to 200 kHz', '20 Hz to 2 kHz'], 'The top end falls with age and loud-sound exposure.', W(3)),
  ]),
  lesson(3, 1, 'Amplitude and loudness', [
    'Amplitude is the size of a vibration: how far the string swings, or how big the pressure changes in the air are. Pluck gently and the amplitude is small; dig in and it is large.',
    'Frequency and amplitude are separate. A string can swing widely or barely at all and still make the same number of cycles each second, so a soft note and a loud note can have exactly the same pitch.',
    'Loudness is how strong a sound seems to you. A bigger amplitude sounds louder, but not in a straight line. The ear copes with an enormous span of pressures, from a whisper to a jet engine (millions to one), by judging ratios rather than differences: going from 1 to 2 units of pressure sounds like about the same step as going from 100 to 200.',
    'A vibration loses energy over time, to the air, to the guitar\'s body and to friction inside the string, so its amplitude shrinks. That gradual fading is called decay.',
  ], [
    qa('amplitude', 'What is amplitude?', 'The size of a vibration: how far something swings, or how big the pressure changes are.', W(1)),
    mc('soft-loud', 'You play the same note softly, then loudly. What changes?', 'The amplitude, not the frequency', ['The frequency, not the amplitude', 'Both the frequency and the amplitude', 'Neither'], 'Pitch follows frequency; loudness follows amplitude. They are independent.', B(13)),
    qa('loudness', 'What is loudness?', 'How strong a sound seems to a listener. It grows with amplitude, but the ear judges ratios, not differences.', B(13)),
    mc('ratios', 'Which pair of changes sounds like about the same step in loudness?', 'Pressure going from 1 to 2, and from 100 to 200', ['From 1 to 2, and from 100 to 101', 'From 1 to 2, and from 100 to 102', 'From 1 to 10, and from 100 to 101'], 'Both are a doubling. The ear hears equal ratios as equal steps.', W(3)),
    qa('decay', 'What is decay, and why does a plucked note decay?', 'The fading of a vibration over time. The string loses energy to the air, to the guitar\'s body and to friction inside the string.', B(4)),
    mc('why-ratios', 'Why does the ear judge loudness by ratios rather than differences?', 'It has to cover pressures from a whisper to a jet engine, a span of millions to one', ['It can only hear one frequency at a time', 'Loud sounds travel faster', 'Pressure changes are always the same size'], 'Ratios let one sense cover an enormous range.', W(3)),
  ]),
  lesson(4, 1, 'Decibels', [
    'Because the ear works in ratios, sound levels are measured in decibels (dB). A decibel figure is a ratio between two levels on a logarithmic scale: equal steps in dB are equal ratios, so adding dB means multiplying the level.',
    'Power is the rate at which a sound carries energy; it goes up with the square of the pressure. Two rules of thumb carry you far. Double the pressure and the level rises about 6 dB. Double the power (for example two equal speakers playing unrelated sounds instead of one) and it rises about 3 dB.',
    'When dB describes how loud something actually is, it needs a reference: the 0 dB point. dB SPL (sound pressure level) uses 20 micropascals, roughly the quietest 1 kHz tone a young ear can hear. A quiet room is about 30 dB SPL, conversation about 60, a loud band 100 or more. Around 120 dB SPL sound starts to hurt.',
    'How the numbers feel: about 1 dB is the smallest change most people notice, and a sound has to rise about 10 dB to seem roughly twice as loud.',
    'Moving away from a small source in open air, the level falls about 6 dB each time you double the distance, because the same sound spreads over four times the area. This is the inverse square law.',
  ], [
    qa('what-is-db', 'What does a decibel figure express?', 'A ratio between two levels, on a logarithmic scale: equal dB steps are equal ratios.', W(1)),
    mc('double-pressure', 'Doubling the sound pressure raises the level by about…', '6 dB', ['3 dB', '10 dB', '2 dB'], 'For pressure the level in dB is 20 × log10 of the ratio, and 20 × log10(2) ≈ 6.', W(1)),
    mc('double-power', 'Doubling the power raises the level by about…', '3 dB', ['6 dB', '10 dB', '1 dB'], 'For power it is 10 × log10 of the ratio, and 10 × log10(2) ≈ 3.', W(1)),
    qa('spl-zero', 'What is the reference for 0 dB SPL?', 'A pressure of 20 micropascals, roughly the quietest 1 kHz tone a young, healthy ear can hear.', W(1)),
    mc('twice-loud', 'Roughly how many dB louder must a sound be to seem twice as loud?', 'About 10 dB', ['About 1 dB', 'About 3 dB', 'About 40 dB'], 'Doubling the power (+3 dB) is clearly louder, but not twice as loud.', B(13)),
    mc('smallest-change', 'About what is the smallest change in level most people notice?', 'About 1 dB', ['About 0.01 dB', 'About 10 dB', 'About 20 dB'], 'Smaller changes are easy to imagine and hard to hear.', W(3)),
    mc('distance', 'In open air, doubling your distance from a small source lowers its level by about…', '6 dB', ['3 dB', '10 dB', '1 dB'], 'The same sound spreads over four times the area: the inverse square law.', W(19)),
    qa('everyday-levels', 'Roughly how loud are a quiet room, conversation and a loud band, in dB SPL?', 'About 30, 60 and 100 or more. Around 120 dB SPL, sound starts to hurt.', W(3)),
  ]),
  lesson(5, 1, 'Wavelength', [
    'Wavelength is the distance a sound wave travels during one cycle, from one compression to the next. It equals the speed of sound divided by the frequency.',
    'Low notes have long wavelengths and high notes short ones. At 343 metres per second, 110 Hz (the open A string) has a wavelength of about 3.1 metres, roughly 10 feet. 1 kHz is about 34 cm (13 inches), and 20 Hz, the bottom of hearing, about 17 metres.',
    'Wavelength explains a lot about how sound behaves. Sound bends around things much smaller than its wavelength and is blocked or reflected by things much larger. That is why the bass from a neighbour\'s party comes through walls and round corners while the treble (the high frequencies) does not.',
    'It matters in rooms too: when a distance in the room matches half a wavelength, sound bouncing between the walls can reinforce itself. We come back to that in the lesson on rooms.',
  ], [
    qa('wavelength', 'What is wavelength?', 'The distance a sound wave travels during one cycle: the speed of sound divided by the frequency.', W(1)),
    mc('a110', 'About how long is the wavelength of 110 Hz (the open A string) in air?', 'About 3 metres (10 feet)', ['About 3 cm', 'About 30 cm', 'About 30 metres'], '343 ÷ 110 ≈ 3.1 metres.', W(1)),
    mc('one-khz', 'About how long is the wavelength of 1 kHz in air?', 'About 34 cm (13 inches)', ['About 3.4 cm', 'About 3.4 metres', 'About 34 metres'], '343 ÷ 1,000 ≈ 0.34 metres.', W(1)),
    mc('higher-shorter', 'Raise the frequency and the wavelength…', 'Gets shorter', ['Gets longer', 'Stays the same', 'Doubles'], 'Wavelength = speed ÷ frequency, and the speed does not change.', B(3)),
    qa('walls', 'Why does bass come through walls and round corners while treble does not?', 'Long bass wavelengths bend around and pass obstacles smaller than they are; short treble wavelengths are blocked and reflected.', W(19)),
    qa('twenty-hz', 'Roughly how long is the wavelength of 20 Hz, the bottom of hearing?', 'About 17 metres (56 feet): longer than most rooms.', W(19)),
  ]),
  lesson(6, 1, 'Sine waves, phase and adding sounds', [
    'The simplest vibration is a smooth, even swing, like a pendulum or a weight bouncing on a spring. Its graph is a sine wave, and it sounds like a pure tone: a plain sound with one frequency and nothing else. A tuning fork comes close.',
    'Phase says where in its cycle a wave is at a given moment, in degrees. A full cycle is 360°; half a cycle is 180°.',
    'When two waves meet, their pressures add. Two identical waves in phase (peaks lined up with peaks) add up to double the pressure: +6 dB. If one is 180° out of phase, half a cycle late, every peak meets a trough and they cancel. Waves partly out of step land in between. Two unrelated sounds of equal level add in power instead: +3 dB.',
    'Polarity is not the same as phase. Flipping the polarity turns the whole wave upside down at every frequency at once, as a reversed speaker wire does. A delay shifts the phase by a different amount at each frequency.',
    'When a sound is mixed with a slightly delayed copy of itself (two microphones at different distances, or a reflection off a nearby wall), some frequencies add and others cancel. The result has a row of evenly spaced dips, like the teeth of a comb, so it is called comb filtering.',
  ], [
    qa('sine', 'What is a sine wave, and what does it sound like?', 'The graph of the simplest smooth back-and-forth vibration. It sounds like a pure tone: one frequency only.', B(3)),
    qa('phase', 'What does phase describe?', 'Where a wave is in its cycle at a given moment, in degrees: 360° is a full cycle, 180° half a cycle.', W(1)),
    mc('in-phase', 'Two identical sounds, perfectly in phase, are added. The level rises by…', '6 dB', ['3 dB', '0 dB', '12 dB'], 'Identical pressures add directly: double the pressure is +6 dB.', W(5)),
    mc('out-of-phase', 'Two identical sounds, one 180° out of phase with the other, are added. The result is…', 'Silence: they cancel', ['Twice as loud', 'An octave higher', 'The same as one sound'], 'Every peak meets a trough of the same size.', W(1)),
    mc('unrelated', 'Two different, unrelated sounds of equal level play together. The total rises by about…', '3 dB', ['6 dB', '0 dB', '10 dB'], 'Unrelated sounds add in power, not pressure: double the power is +3 dB.', W(5)),
    qa('polarity', 'How is flipping polarity different from a delay?', 'Flipping polarity turns the wave upside down at every frequency at once. A delay shifts the phase by a different amount at each frequency.', W(2)),
    mc('comb', 'Mixing a sound with a slightly delayed copy of itself causes…', 'Comb filtering: a row of evenly spaced dips', ['A pitch shift up an octave', 'A louder sound at every frequency', 'A slower tempo'], 'At some frequencies the copy arrives in phase and adds; at others it arrives out of phase and cancels.', W(2)),
  ]),

  // ===================================================== Chapter 2: Musical tones
  lesson(7, 2, 'Partials, harmonics and timbre', [
    'Almost no real sound is a single sine wave. A guitar note is many sine waves sounding at once. Each one is called a partial. The lowest is the fundamental, and it usually sets the pitch you hear.',
    'In a guitar string the partials sit at whole-number multiples of the fundamental. Open A at 110 Hz also has partials at 220, 330, 440, 550 Hz and on up. Partials at whole-number multiples are called harmonics, and the whole set is the harmonic series. The fundamental is the 1st harmonic, 220 Hz the 2nd, and so on. Partials above the fundamental are also called overtones.',
    'Timbre (say "tam-ber") is the colour of a sound: what makes a guitar and a piano playing the same note equally loud sound different. It comes mostly from how strong each partial is, and from how the sound starts (its attack) and fades.',
    'The mix of partials changes while a note rings. In a plucked string the higher partials die away faster than the lower ones, so a note gets darker as it fades.',
  ], [
    qa('partial', 'What is a partial, and what is the fundamental?', 'A partial is one of the sine waves that together make up a sound. The fundamental is the lowest one, and usually sets the pitch.', B(4)),
    mc('multiples', 'The open A string vibrates at 110 Hz. What are its 2nd, 3rd and 4th harmonics?', '220, 330 and 440 Hz', ['220, 440 and 880 Hz', '110, 220 and 330 Hz', '165, 220 and 275 Hz'], 'The nth harmonic is n times the fundamental.', B(5)),
    qa('harmonic', 'What makes a partial a harmonic?', 'Its frequency is a whole-number multiple of the fundamental. Together the harmonics form the harmonic series.', B(5)),
    qa('overtone', 'Is the fundamental an overtone?', 'No. Overtones are the partials above the fundamental. The fundamental is the 1st harmonic, so the 1st overtone is the 2nd harmonic.', B(5)),
    qa('timbre', 'What gives two instruments playing the same note equally loud their different sound?', 'Timbre: mostly the relative strengths of their partials, plus how the sound starts and fades.', B(4)),
    mc('darker', 'Why does a ringing guitar note get darker as it fades?', 'Its higher partials die away faster than the lower ones', ['Its pitch drops as it fades', 'The fundamental fades first', 'The string stretches as it rings'], 'The spectrum tilts toward the fundamental over time.', B(4)),
  ]),
  lesson(8, 2, 'Intervals and beats', [
    'An interval is the distance in pitch between two notes. The ear hears intervals as ratios of frequency: what matters is how many times higher one note is, not how many hertz apart.',
    'The harmonic series holds the basic intervals of music. Harmonics 1 and 2 (ratio 2:1) are an octave apart. Harmonics 2 and 3 (3:2) make a perfect fifth, 3 and 4 (4:3) a perfect fourth, 4 and 5 (5:4) a major third, and 5 and 6 (6:5) a minor third. Intervals tuned to simple ratios like these are called pure.',
    'Notes a simple ratio apart share many harmonics, which is a big part of why they blend. Play A at 110 Hz with E at 165 Hz (a pure fifth): A\'s 3rd harmonic and E\'s 2nd harmonic are both exactly 330 Hz.',
    'When two tones are close but not equal, their combined loudness swells and fades regularly. These pulses are called beats, and the number per second equals the difference between the two frequencies. Tuning by ear means slowing the beats until they stop.',
  ], [
    qa('interval', 'How does the ear judge the interval between two notes?', 'By the ratio of their frequencies, not by how many hertz apart they are.', B(14)),
    mc('octave-ratio', 'Which frequency ratio is an octave?', '2:1', ['3:2', '4:3', '5:4'], 'An octave doubles the frequency.', B(14)),
    mc('fifth', 'Which interval lies between the 2nd and 3rd harmonics?', 'A perfect fifth (3:2)', ['An octave (2:1)', 'A perfect fourth (4:3)', 'A major third (5:4)'], 'Their frequencies are in the ratio 3:2.', B(14)),
    mc('fourth', 'Which interval lies between the 3rd and 4th harmonics?', 'A perfect fourth (4:3)', ['A perfect fifth (3:2)', 'A major third (5:4)', 'A minor third (6:5)'], 'Their frequencies are in the ratio 4:3.', B(14)),
    qa('thirds', 'Which intervals lie between harmonics 4 and 5, and between 5 and 6?', 'A major third (5:4) and a minor third (6:5).', B(14)),
    qa('shared', 'A is 110 Hz and E is 165 Hz. Which frequency do their harmonics share first?', '330 Hz: A\'s 3rd harmonic and E\'s 2nd. Shared harmonics help a fifth blend.', B(14)),
    mc('beats', 'Two tones at 440 Hz and 443 Hz sound together. How many beats per second?', '3', ['443', '1.5', '6'], 'The beat rate is the difference between the two frequencies.', B(14)),
    qa('tune-by-ear', 'When you tune two strings to each other by ear, what are you listening for?', 'The beats between them slowing down. When they stop, the frequencies match.', B(14)),
  ]),
  lesson(9, 2, 'How we hear pitch, and cents', [
    'Pitch usually follows the fundamental, but the ear works it out from the whole pattern of harmonics. Hear 200, 300 and 400 Hz together with nothing at 100 Hz and you still hear a pitch of 100 Hz: the even spacing of the harmonics gives it away. This is called the missing fundamental. It is why a phone speaker that cannot play a bass note still lets you hear the note\'s pitch.',
    'A semitone is the step from one fret to the next, or from one piano key to the next. To measure smaller pitch differences, musicians use cents: an octave is split into 1200 cents, so a semitone is 100 cents. Like decibels for level, cents are ratio steps.',
    'Played one after the other, two notes need to be a few cents apart (around 5) before most people can tell them apart. Played together, beats give away far smaller differences.',
    'A tuner reading "+10" means the note is 10 cents sharp (too high); "−10" means 10 cents flat (too low).',
  ], [
    mc('missing', 'You hear partials at 200, 300 and 400 Hz and nothing at 100 Hz. What pitch do you hear?', 'About 100 Hz', ['200 Hz', '300 Hz', 'No clear pitch'], 'The ear infers the common fundamental from the spacing of the harmonics.', B(5)),
    qa('phone-speaker', 'How can you hear a bass note\'s pitch on a phone speaker that cannot play its fundamental?', 'The ear works out the pitch from the spacing of the harmonics the speaker does play: the missing fundamental.', B(5)),
    mc('cents-octave', 'How many cents make an octave?', '1200', ['100', '700', '1000'], 'Twelve semitones of 100 cents each.', B(14)),
    qa('semitone', 'What is a semitone, and how many cents is it?', 'The step from one fret to the next (or one piano key to the next): 100 cents.', B(14)),
    mc('tuner', 'A tuner shows −15 for your G string. The string is…', '15 cents flat: tune it up', ['15 cents sharp: tune it down', '15 Hz too low', 'In tune'], 'Minus means below the target pitch.', B(14)),
    mc('smallest-pitch', 'Played one after the other, about how far apart must two notes be for most people to hear a difference?', 'A few cents (around 5)', ['About 50 cents', 'A semitone (100 cents)', 'About 0.01 cents'], 'Played together, beats reveal much smaller differences.', W(3)),
  ]),

  // ================================================== Chapter 3: The guitar string
  lesson(10, 3, 'The vibrating string', [
    'A guitar string is held still at two points: the nut (or the fret you hold down) and the saddle on the bridge. The part between them, the vibrating length, is what sounds.',
    'A string can vibrate in several shapes at once. Each shape is a mode. In the 1st mode the whole string swings as one arc. In the 2nd it swings in two halves moving in opposite directions, in the 3rd in three parts, and so on. Mode n vibrates at n times the frequency of mode 1: the modes are the harmonics.',
    'Points that stay still in a mode are its nodes; the points that swing most are its antinodes. The two ends are always nodes. Mode n has n − 1 nodes between the ends, evenly spaced.',
    'A pluck sets many modes going at once. What you hear is their sum: the fundamental from mode 1 and the higher harmonics from the rest.',
  ], [
    qa('vibrating-length', 'What is a string\'s vibrating length?', 'The part between its two still points: the nut (or the fret held down) and the saddle.', B(7)),
    qa('mode', 'What is a mode of a vibrating string?', 'One of the shapes it can vibrate in (one arc, two halves, three parts and so on), each at its own frequency.', B(6)),
    qa('node', 'What are nodes and antinodes?', 'Nodes are points that stay still in a mode; antinodes are the points that swing the most.', B(6)),
    mc('nodes-count', 'How many nodes does the 3rd mode have between the two ends?', '2', ['3', '1', '4'], 'Mode n has n − 1 nodes between the ends.', B(6)),
    mc('mode-frequency', 'The 1st mode of a string is 100 Hz. What is the 4th mode?', '400 Hz', ['104 Hz', '1,600 Hz', '250 Hz'], 'Mode n vibrates at n times the 1st mode.', B(7)),
    mc('shared-nodes', 'Where are the nodes that every mode of a guitar string shares?', 'At the two ends', ['At the middle', 'At the 12th fret', 'Nowhere'], 'The nut and saddle hold the ends still for every mode.', B(6)),
  ]),
  lesson(11, 3, 'Length, tension and frets', [
    'Three things set a string\'s fundamental: its vibrating length, its tension (how tightly it is stretched) and its mass per unit length (how heavy each inch of it is). Shorter, tighter or lighter means higher.',
    'Frequency goes inversely with vibrating length: halve the length and the frequency doubles, one octave up. That is why the 12th fret sits exactly halfway between the nut and the saddle.',
    'Tension acts more gently: frequency rises with the square root of tension, so raising a string an octave by tension alone would take four times the pull. A heavier string needs more tension to reach the same note.',
    'Each fret raises the pitch a semitone, multiplying the frequency by about 1.0595 (the twelfth root of 2). So each fret shortens the remaining string by the same proportion, about 5.6%. As the string gets shorter, 5.6% of it is less distance, so the frets get closer together toward the body.',
    'Scale length is the vibrating length of the open strings, nut to saddle. Two common ones are 25.5 and 24.75 inches. A longer scale needs more tension for the same note and string.',
  ], [
    qa('three-things', 'Which three properties of a string set its fundamental frequency?', 'Vibrating length, tension, and mass per unit length. Shorter, tighter or lighter sounds higher.', B(7)),
    mc('half-length', 'Fretting at the 12th fret halves the vibrating length. The pitch…', 'Rises an octave', ['Rises a fifth', 'Rises two octaves', 'Does not change'], 'Frequency goes inversely with length: half the length, double the frequency.', B(7)),
    mc('tension-octave', 'To raise a string one octave by tension alone, the tension must be multiplied by about…', '4', ['2', '1.5', '8'], 'Frequency rises with the square root of tension, so doubling it needs four times the tension.', B(7)),
    qa('fret-ratio', 'What does one fret do to the frequency?', 'Multiplies it by about 1.0595 (the twelfth root of 2): one semitone.', B(7)),
    qa('fret-spacing', 'Why do frets get closer together toward the body?', 'Each fret shortens the remaining string by the same proportion (about 5.6%), and that proportion is a smaller distance as the string gets shorter.', B(7)),
    mc('scale-tension', 'Same strings, same tuning: compared with a 24.75-inch scale, a 25.5-inch scale has…', 'More tension (about 6% more)', ['Less tension', 'The same tension', 'Twice the tension'], 'For the same note, tension grows with the square of the length: (25.5 ÷ 24.75)² ≈ 1.06.', B(7)),
    mc('gauge', 'Same scale length and tuning, heavier strings: the tension…', 'Goes up', ['Goes down', 'Stays the same', 'Depends only on the scale length'], 'More mass per unit length needs more tension to reach the same pitch.', B(7)),
  ]),
  lesson(12, 3, 'Where you pluck, and natural harmonics', [
    'Where you pluck decides which modes get going. A mode cannot be started at one of its own nodes, because that point does not move in that mode. Pluck exactly at the middle of the string, a node of every even-numbered mode, and the 2nd, 4th, 6th harmonics and so on are almost missing: a hollow, soft sound.',
    'Pluck close to the saddle and you excite the high modes strongly, for a bright, thin tone. Pluck nearer the middle and most of the energy goes into the low modes, for a round, warm tone. A thin, hard pick (a sharp, narrow pluck) adds more high partials than the soft, wide flesh of a thumb.',
    'A natural harmonic forces a node. Touch the string lightly right over a fret (without pressing it down) and pluck: only the modes with a node at that spot keep sounding. Over the 12th fret, half the length, the lowest such mode is the 2nd harmonic, an octave up. Over the 7th fret, a third of the length, it is the 3rd harmonic, an octave and a fifth up. Over the 5th fret, a quarter of the length, it is the 4th harmonic, two octaves up.',
  ], [
    mc('midpoint', 'Plucking a string exactly at its midpoint weakens which harmonics?', 'The even-numbered ones', ['The odd-numbered ones', 'Only the fundamental', 'None of them'], 'Every even-numbered mode has a node at the midpoint, so a pluck there barely starts it.', B(7)),
    qa('bright-pluck', 'Why does picking near the bridge sound brighter than picking over the end of the fretboard?', 'A pluck near the end of the string excites the high modes strongly; a pluck nearer the middle puts most energy into the low modes.', B(7)),
    mc('pick-thumb', 'Which gives the brightest attack?', 'A thin, hard pick', ['The flesh of the thumb', 'A soft felt pick', 'The side of the palm'], 'A sharp, narrow pluck starts more high partials.', B(8)),
    qa('natural-harmonic', 'How does a natural harmonic work?', 'A light touch forces a node at that spot, so only the modes with a node there keep sounding.', B(7)),
    mc('seventh-fret', 'Touching lightly over the 7th fret and plucking gives which harmonic?', 'The 3rd: an octave and a fifth above the open string', ['The 2nd: one octave up', 'The 4th: two octaves up', 'The 7th'], 'The 7th fret is a third of the way along; the lowest mode with a node there is the 3rd.', B(7)),
    qa('fifth-fret', 'Why does the harmonic over the 5th fret sound two octaves up?', 'The 5th fret is a quarter of the way along; the lowest mode with a node there is the 4th harmonic, two octaves above the open string.', B(7)),
  ]),
  lesson(13, 3, 'Real strings and intonation', [
    'A perfect string would be completely floppy. A real one is stiff: it resists bending, a little like a thin rod. Stiffness matters most for the high modes, which bend the string into many short curves, and it pushes their frequencies slightly sharp of exact whole-number multiples. This is inharmonicity. It is worse in thick, short, stiff strings.',
    'That is one reason the low strings are wound: wire wrapped round a thin core adds mass (which lowers the pitch at a playable tension) without adding much stiffness.',
    'Pressing a string down to a fret stretches it slightly, raising its tension, so fretted notes come out a touch sharp, more so with a high action (string height above the frets) or a heavy hand. A note hit hard can start sharp too: a big swing stretches the string, and the pitch settles as the swing dies down.',
    'Intonation is how closely the fretted notes match the pitches they should be. To make up for the sharpening, each saddle sits slightly farther from the nut than the exact scale length; this is compensation. Setting the intonation means moving each saddle until the note fretted at the 12th fret matches the 12th-fret natural harmonic.',
  ], [
    qa('inharmonicity', 'What is inharmonicity in a guitar string, and what causes it?', 'The upper partials run slightly sharp of exact whole-number multiples. The string\'s stiffness causes it.', B(8)),
    mc('wound', 'Why are the low guitar strings wound?', 'To add mass without adding much stiffness', ['To make them stronger', 'To reduce finger noise', 'To make them magnetic'], 'A solid wire that heavy would be too stiff.', B(8)),
    mc('action', 'Raising the action (string height) usually makes fretted notes…', 'Sharper', ['Flatter', 'No different in pitch', 'Quieter but no different in pitch'], 'A taller action means more stretch when you press down, which raises the tension.', B(7)),
    qa('hard-pick', 'Why can a hard-picked note start slightly sharp and then settle?', 'A big swing stretches the string, briefly raising its tension and pitch; as the swing dies down the pitch settles.', B(8)),
    qa('compensation', 'What is saddle compensation for?', 'Fretting stretches the string and stiffness raises fretted pitch, so notes go sharp. Setting the saddle a little farther back brings them into tune.', B(7)),
    mc('intonation-check', 'When setting intonation, the note fretted at the 12th fret is compared with…', 'The 12th-fret natural harmonic', ['The open string\'s fundamental', 'The 5th-fret harmonic', 'The note at the 24th fret'], 'Both should be exactly an octave above the open string.', B(7)),
    mc('pressing', 'Which fretting habit pulls notes sharp?', 'Pressing too hard or pushing the string sideways', ['Fretting just behind the fret', 'Using light pressure', 'Using a capo set straight'], 'Extra pressure or sideways push stretches the string and raises its tension.', B(7)),
  ]),
  lesson(14, 3, 'Tuning systems and temperament', [
    'Pure intervals do not fit together evenly. Stack twelve pure fifths and you overshoot seven octaves by about 23.5 cents (the Pythagorean comma). Go up four pure fifths and drop two octaves and you land about 21.5 cents above a pure major third (the syntonic comma). No fixed set of pitches can make every interval pure in every key; a small leftover like this is called a comma.',
    'A temperament is a deliberate compromise: some intervals are tuned slightly off pure so the whole system works. Just intonation keeps intervals pure in one key, and the other keys suffer.',
    'Guitars use twelve-tone equal temperament: the octave is split into twelve identical semitones of 100 cents, so every key sounds alike. The cost: the equal-tempered fifth is 700 cents, about 2 cents narrower than pure (702); the equal-tempered major third is 400 cents, about 14 cents wider than pure (386). That is why a major chord on the guitar shimmers a little instead of sounding perfectly still.',
    'Tuning with the 5th- and 7th-fret harmonics gives pure fourths and fifths, not the equal-tempered ones the frets use, so the small errors pile up across the strings. A tuner or fretted unisons avoid that.',
  ], [
    qa('why-compromise', 'Why can no fixed tuning make every interval pure in every key?', 'Pure intervals do not stack evenly: twelve pure fifths overshoot seven octaves, and fifths do not add up to pure thirds. There is always a small leftover, a comma.', B(16)),
    mc('pythagorean', 'Twelve pure fifths overshoot seven octaves by about…', '23.5 cents (the Pythagorean comma)', ['2 cents', '100 cents', 'Nothing: they match exactly'], 'This leftover is why some compromise is unavoidable.', B(16)),
    qa('temperament', 'What is a temperament?', 'A tuning system that sets some intervals slightly off pure on purpose so the whole system works.', B(16)),
    mc('et-fifth', 'How does the equal-tempered fifth compare with a pure 3:2 fifth?', 'About 2 cents narrow (flat)', ['About 14 cents sharp', 'Exactly the same', 'About 20 cents flat'], '700 cents against about 702: a very small compromise.', B(16)),
    mc('et-third', 'How does the equal-tempered major third compare with a pure 5:4 third?', 'About 14 cents wide (sharp)', ['About 2 cents flat', 'Exactly the same', 'About 50 cents sharp'], '400 cents against about 386, which is why major chords shimmer a little.', B(16)),
    qa('just', 'What is just intonation?', 'Tuning intervals to simple whole-number ratios. Chords in one key are beat-free, but other keys go badly out.', B(15)),
    qa('harmonic-tuning', 'Why can tuning only with 5th- and 7th-fret harmonics leave a guitar slightly out?', 'Those harmonics give pure fourths and fifths, about 2 cents off the equal-tempered intervals the frets use, and the errors add up from string to string.', B(14)),
  ]),

  // ============================================== Chapter 4: Bodies, ears and rooms
  lesson(15, 4, 'Resonance and the guitar body', [
    'Anything that can vibrate has natural frequencies: the frequencies it vibrates at by itself when struck, like a bell. Push on it again and again at one of those frequencies and it responds strongly. That big response is resonance.',
    'A driven vibration is one forced by an outside source, like the string pushing on the bridge. How much an object responds depends on how close the driving frequency is to one of its natural frequencies. Damping is the loss of energy that limits that response and makes free vibrations die out.',
    'A string on its own barely moves the air: it is so thin that air slips round it. On an acoustic guitar the string drives the bridge, the bridge drives the top (the soundboard), and the large top moves a lot of air. The air inside the body, with the soundhole, also works as a resonator, like blowing across a bottle, and reinforces low notes.',
    'Energy that becomes sound is energy the string loses, so a loud acoustic guitar has notes that die out faster than on a heavy solid-body electric, whose stiff body takes little from the string. If a body or neck resonance matches one particular note, it can drain that note fast or make it warble: a dead spot, or wolf note.',
  ], [
    qa('resonance', 'What is resonance?', 'A large response when something is driven at or near one of its own natural frequencies.', B(10)),
    qa('natural-frequency', 'What is a natural frequency?', 'A frequency an object vibrates at on its own when struck or plucked, like the ring of a bell.', B(10)),
    qa('damping', 'What does damping do?', 'It drains energy from a vibration, which limits the size of a resonance and makes free vibrations die out.', B(10)),
    mc('soundboard', 'Why is an acoustic guitar so much louder than a string on its own?', 'The string drives the top through the bridge, and the large top moves a lot of air', ['The soundhole amplifies the string', 'The neck vibrates like a speaker', 'The strings are under more tension'], 'A thin string barely moves the air; the soundboard is a far better radiator.', B(9)),
    qa('body-air', 'What does the air inside an acoustic guitar body do?', 'With the soundhole it forms a resonator (like blowing across a bottle) that reinforces low notes.', B(10)),
    mc('sustain', 'Why do notes on a solid-body electric usually sustain longer than on an acoustic?', 'Its stiff, heavy body takes much less energy from the string', ['Its strings are thicker', 'Electric guitars are tuned higher', 'The amplifier keeps the strings ringing'], 'An acoustic spends the string\'s energy on being loud.', B(4)),
    mc('wolf', 'A note that dies quickly or warbles while its neighbours ring is usually caused by…', 'A body or neck resonance that matches that note', ['A worn fret', 'Old strings', 'The wrong pick'], 'The structure takes energy from the string at that pitch, or beats against it.', B(25)),
  ]),
  lesson(16, 4, 'Hearing: sensitivity, masking and safety', [
    'The ear is not equally sensitive at all frequencies. It is most sensitive around 2 to 5 kHz, helped by a resonance of the ear canal, and much less sensitive to deep bass and the very top end, especially when sounds are quiet. Curves showing how loud each frequency must be to seem equally loud are called equal-loudness contours.',
    'One result: a mix played quietly sounds thin, because the bass seems to drop away as the volume goes down. Another: louder nearly always sounds "better", so compare two mixes or settings at the same loudness.',
    'Masking is a loud sound making quieter sounds near its frequency hard or impossible to hear. It reaches further above the loud sound\'s frequency than below. Two instruments fighting for the same range in a mix are masking each other.',
    'Hearing damage depends on level and time together. dB(A) is a level measured through a filter that weighs frequencies roughly the way the ear does at moderate levels. A widely used safety guideline is 85 dB(A) for 8 hours, with the safe time halving for every 3 dB louder: 88 for 4 hours, 91 for 2, and so on. Ringing ears after a gig are a warning sign.',
  ], [
    mc('most-sensitive', 'Human hearing is most sensitive around…', '2 to 5 kHz', ['50 to 100 Hz', '200 to 500 Hz', '12 to 16 kHz'], 'A resonance of the ear canal helps put peak sensitivity in this range.', W(3)),
    qa('quiet-thin', 'Why does a mix played quietly sound thinner than the same mix played loud?', 'As the level drops, the ear loses sensitivity to low frequencies faster than to the mids, so the bass seems to fade away.', W(3)),
    qa('contours', 'What do equal-loudness contours show?', 'How loud each frequency must be to seem as loud as the others, with a different curve at each overall level.', B(13)),
    mc('match-loudness', 'Before comparing two mixes or two settings, why match their loudness?', 'The louder one almost always sounds better, whatever else differs', ['Quieter mixes have more distortion', 'Meters only work at one level', 'Matching loudness removes masking'], 'Otherwise you are judging the volume, not the change.', W(3)),
    qa('masking', 'What is masking?', 'A loud sound making quieter sounds near its frequency hard or impossible to hear. It reaches further above the loud sound\'s frequency than below.', W(3)),
    qa('dba', 'What is dB(A)?', 'A level measured through a filter that weighs frequencies roughly as the ear does at moderate levels, playing down deep bass and the extreme highs.', W(1)),
    mc('safe-time', 'With the 85 dB(A)-for-8-hours guideline and its 3 dB rule, about how long is safe at 94 dB(A)?', 'About 1 hour', ['About 4 hours', 'About 7 hours', 'About 15 minutes'], '88 dB(A): 4 hours; 91: 2 hours; 94: 1 hour.', G('NIOSH occupational noise guideline (85 dBA, 3 dB exchange rate)')),
  ]),
  lesson(17, 4, 'Rooms', [
    'Indoors you hear the direct sound plus reflections off the walls, floor and ceiling. Reflections arriving within a few tens of milliseconds of the direct sound fuse with it: you do not hear them as separate echoes, but they change the tone and the sense of space. You judge where a sound comes from mostly by whichever arrival reaches you first (the precedence effect).',
    'Later reflections pile up into reverberation, a smooth wash that dies away. RT60 is the time reverberation takes to fall by 60 dB once the source stops. A small furnished room may be well under half a second; a big church several seconds.',
    'At low frequencies a room behaves differently. When half a wavelength fits exactly between two parallel surfaces, sound bouncing back and forth reinforces itself into a standing wave, called a room mode, at the speed of sound divided by twice the distance. Between walls 4 metres apart the first mode is about 43 Hz, with more at 86, 129 Hz and so on. Modes make some bass notes boom and others vanish, depending on where you sit.',
    'Acoustic treatment controls this. Absorbers soak up sound energy; thin foam works only on high frequencies, and taming bass needs thick or specially built bass traps. Diffusers scatter reflections instead of absorbing them, keeping a room lively without clear echoes.',
  ], [
    qa('early-reflections', 'What do reflections arriving within a few tens of milliseconds do to what you hear?', 'They fuse with the direct sound: they colour its tone and sense of space without being heard as separate echoes.', B(12)),
    mc('precedence', 'You judge where a sound comes from mostly by…', 'Whichever arrival reaches you first', ['The loudest reflection', 'The last reflection', 'The average of all the reflections'], 'This is the precedence effect.', B(12)),
    qa('rt60', 'What is RT60?', 'The time reverberation takes to die away by 60 dB once the source stops.', W(19)),
    qa('room-mode', 'What is a room mode?', 'A standing wave at a frequency where half a wavelength fits exactly between two surfaces, so sound bouncing between them reinforces itself.', W(20)),
    mc('mode-calc', 'Two parallel walls are 4 metres apart. About where is the first room mode between them?', 'About 43 Hz', ['About 4 Hz', 'About 430 Hz', 'About 4.3 kHz'], 'Speed of sound ÷ (2 × distance) = 343 ÷ 8 ≈ 43 Hz.', W(20)),
    mc('foam', 'Thin acoustic foam on the walls mainly absorbs…', 'High frequencies', ['Low frequencies', 'All frequencies equally', 'One single frequency'], 'Bass wavelengths are far longer than the foam is thick; bass needs thick traps.', W(21)),
    qa('absorb-diffuse', 'What is the difference between an absorber and a diffuser?', 'An absorber soaks up sound energy; a diffuser scatters reflections in many directions, keeping the room lively without clear echoes.', W(21)),
  ]),

  // ============================================ Chapter 5: Recording and sound engineering
  lesson(18, 5, 'Microphones and pickups', [
    'A transducer turns one kind of energy into another. Microphones and guitar pickups turn vibration into an electrical signal: a voltage (electrical push, measured in volts) that rises and falls in step with the sound. Speakers do the reverse.',
    'A dynamic microphone has a diaphragm fixed to a coil of wire that sits in a magnet\'s field; moving the coil makes a voltage. It is rugged and needs no power. A condenser microphone uses a very light diaphragm as one plate of a capacitor (two plates holding an electric charge); it catches fine detail and needs power, usually 48-volt phantom power sent along the microphone cable.',
    'A microphone\'s polar pattern shows how well it hears from each direction. Omni hears all round. Cardioid (heart-shaped) favours the front and rejects the back. Figure-8 hears front and back and rejects the sides. Directional microphones add bass when very close to the source: the proximity effect.',
    'A magnetic guitar pickup is a magnet wrapped in thousands of turns of thin wire. The steel string moving through its field changes the magnetism through the coil, and that change makes a voltage. A humbucker uses two coils wired so that hum from outside cancels while the string\'s signal adds.',
    'A pickup hears the string only where it sits. Near the bridge the string moves little except in its higher modes, so a bridge pickup sounds brighter; nearer the neck the low modes swing widely, so a neck pickup sounds warmer.',
  ], [
    qa('transducer', 'What is a transducer? Give two guitar-related examples.', 'A device that turns one kind of energy into another: a microphone or pickup (vibration to electricity), a speaker (electricity to sound).', W(17)),
    mc('phantom', 'Which kind of microphone normally needs phantom power?', 'Condenser', ['Dynamic', 'None: phantom power is for speakers', 'A magnetic guitar pickup'], 'The capacitor needs a charge, and many condensers have built-in electronics too.', W(17)),
    mc('cardioid', 'A cardioid microphone mainly rejects sound from…', 'Behind it', ['In front of it', 'Only the sides', 'Nowhere: it hears all round'], 'Its heart-shaped pattern favours the front.', W(17)),
    qa('proximity', 'What is the proximity effect?', 'The extra bass a directional microphone gives when it is very close to the source.', W(17)),
    qa('pickup', 'How does a magnetic pickup make a signal?', 'The steel string moving in the magnet\'s field changes the magnetism through the coil, and that change makes a voltage.', W(17)),
    mc('humbucker', 'Why does a humbucker hum less than a single-coil pickup?', 'Its two coils are wired so outside hum cancels while the string\'s signal adds', ['It has a stronger magnet', 'It sits farther from the strings', 'Its cover blocks all electrical noise'], 'Hum reaches both coils equally and cancels; the string signal does not.', W(17)),
    mc('neck-bridge', 'Why does a neck pickup sound warmer than a bridge pickup?', 'It sits where the low modes swing widely; near the bridge the string moves mostly in its higher modes', ['It has more turns of wire', 'It is nearer the amplifier', 'The neck soaks up the treble'], 'A pickup hears the string\'s motion only at its own position.', W(26)),
  ]),
  lesson(19, 5, 'Signal levels and gain staging', [
    'Audio signals come at very different strengths. Mic level is tiny (thousandths of a volt) and needs a preamp, an amplifier that raises it. Instrument level, from a passive guitar (one with no battery-powered electronics), is stronger but delicate. Line level is the strong signal that mixers, interfaces and effects pass to each other. A signal\'s voltage follows the same rule as pressure: double it and the level rises 6 dB. Professional gear runs around +4 dBu and home gear around −10 dBV, about 12 dB apart (0 dBu is 0.775 volts and 0 dBV is 1 volt).',
    'Impedance is how much a circuit resists a changing current, measured in ohms. A passive pickup has a high impedance and loses treble and level when it feeds a low-impedance input, which is why guitar inputs are about 1 megohm (a million ohms). A DI (direct injection) box turns an instrument signal into a low-impedance, balanced, mic-level one for long cables and mixer inputs.',
    'A balanced cable carries the signal on two wires, one the mirror image of the other. Noise picked up on the way lands on both wires equally, and the input keeps only the difference, so the noise cancels.',
    'Every device adds a little noise; the noise floor is the level of that background hiss. Clipping happens when a signal goes past the most a device can handle: its peaks are flattened, which sounds harsh. Headroom is the space between your normal level and clipping. Signal-to-noise ratio is the gap between your normal level and the noise floor. Gain staging means setting the level at each step so the signal stays well above the noise and well below clipping, getting most of the gain at the first stage, the preamp, because noise added later is not raised by it.',
  ], [
    mc('three-levels', 'From weakest to strongest, which order is right?', 'Mic level, instrument level, line level', ['Line, mic, instrument', 'Instrument, mic, line', 'Mic, line, instrument'], 'Mic level needs the most gain; line level is what gear passes between itself.', W(4)),
    mc('double-voltage', 'Doubling a signal\'s voltage raises its level by about…', '6 dB', ['3 dB', '10 dB', '2 dB'], 'Voltage follows the same rule as pressure.', W(1)),
    mc('pro-home', 'Professional line level (+4 dBu) and home line level (−10 dBV) are about how far apart?', 'About 12 dB', ['About 14 dB', 'About 6 dB', 'About 4 dB'], '+4 dBu is about 1.23 V and −10 dBV about 0.32 V: a ratio near 3.9, or about 12 dB.', W(1)),
    mc('hi-z', 'A passive guitar plugged straight into a low-impedance line input usually sounds…', 'Dull and weak', ['Brighter and louder', 'Exactly the same', 'Distorted only'], 'The low input impedance loads the pickup; guitar inputs are about 1 megohm for this reason.', W(4)),
    qa('di-box', 'What does a DI box do?', 'It turns a high-impedance instrument signal into a low-impedance, balanced, mic-level one for long cables and mixer inputs.', W(4)),
    qa('balanced', 'Why do balanced cables reject noise?', 'The signal travels on two wires as mirror images. Noise lands on both equally and the input keeps only the difference, so the noise cancels.', W(4)),
    qa('headroom', 'What is headroom?', 'The space between your normal operating level and the point where the device clips.', W(2)),
    qa('clipping', 'What is clipping, and how does it sound?', 'A signal going past the most a device can handle, so its peaks are flattened. It sounds harsh and distorted.', W(2)),
    mc('first-stage', 'For the lowest noise, where should most of the gain come from?', 'The first stage (the preamp)', ['The master fader', 'The last effect in the chain', 'The monitor volume'], 'Noise added later is not raised by the earlier gain, so a healthy level early keeps it small by comparison.', W(5)),
  ]),
  lesson(20, 5, 'Guitar frequencies and EQ', [
    'In standard tuning the open strings run from low E at about 82 Hz to high E at about 330 Hz, two octaves higher. The highest note on a 22-fret guitar is about 1.2 kHz. The harmonics carry the sound far higher: the pick\'s attack and the "presence" of a guitar live around 2 to 5 kHz.',
    'An equalizer (EQ) turns frequency ranges up or down. A high-pass filter lets frequencies above its cutoff through and removes those below (it is a low cut); a low-pass filter does the opposite. A shelf raises or lowers everything beyond a corner frequency by the same amount. A bell (peaking) band boosts or cuts around one centre frequency, and its Q sets the width: higher Q, narrower band. A notch is a very narrow, deep cut for one frequency.',
    'Common guitar moves: a high-pass around 80 to 100 Hz to clear rumble and leave room for the bass guitar and kick drum; a cut somewhere around 200 to 500 Hz when several instruments make the low mids muddy; a gentle lift around 2 to 5 kHz for presence. A typical 12-inch guitar speaker already rolls off steeply above about 5 kHz, which is part of the electric guitar\'s sound.',
  ], [
    mc('low-e', 'What is the fundamental of the low E string in standard tuning?', 'About 82 Hz', ['About 41 Hz', 'About 110 Hz', 'About 165 Hz'], 'E2 is 82.4 Hz.', W(26)),
    qa('high-e', 'What is the fundamental of the open high E string?', 'About 330 Hz (E4), two octaves above the low E.', W(26)),
    mc('drop-d', 'What is the fundamental of the low string in drop D?', 'About 73 Hz', ['About 82 Hz', 'About 65 Hz', 'About 98 Hz'], 'D2 is 73.4 Hz, a whole step below E2.', W(26)),
    mc('high-pass', 'What does a high-pass filter do?', 'Lets frequencies above its cutoff through and removes those below', ['Boosts the highs', 'Cuts the highs', 'Removes one narrow frequency'], 'High-pass means the highs pass: it is a low cut.', W(10)),
    qa('q', 'What does the Q control on an EQ band set?', 'How wide the band is: higher Q, narrower band.', W(10)),
    mc('shelf', 'A shelving EQ…', 'Raises or lowers everything beyond its corner frequency by the same amount', ['Affects only one narrow band', 'Removes everything below the corner', 'Changes the pitch'], 'The response looks like a shelf: flat, a slope, then flat again at the new level.', W(10)),
    qa('guitar-high-pass', 'Why is a high-pass filter around 80 to 100 Hz common on guitar tracks?', 'The guitar has almost nothing useful below its low E (82 Hz); cutting there removes rumble and leaves room for the bass and kick drum.', W(10)),
    mc('mud', 'Guitar muddiness in a mix is most often around…', '200 to 500 Hz', ['20 to 50 Hz', '2 to 5 kHz', '10 to 15 kHz'], 'Low-mid build-up from several instruments clouds a mix; listen there first.', W(10)),
    mc('speaker-rolloff', 'A typical 12-inch guitar speaker rolls off steeply above about…', '5 kHz', ['500 Hz', '15 kHz', '20 kHz'], 'That roll-off is part of the sound of an electric guitar through an amp.', W(26)),
  ]),
  lesson(21, 5, 'Compressors, limiters and gates', [
    'Dynamics are the changes in level within a performance, from soft to loud. Dynamics processors control them automatically.',
    'A compressor turns the signal down when it goes above a set level, the threshold. The ratio says how much: at 4:1 a signal 8 dB over the threshold comes out only 2 dB over. Attack is how fast it reacts once the level crosses the threshold; release is how fast it lets go once the level falls back. Because compression lowers the peaks, make-up gain raises the whole signal back up afterwards.',
    'A slow attack lets the pick\'s first snap through before the compressor clamps down, keeping punch. A very fast release can make the level "pump" audibly; a very slow one keeps the sound squashed.',
    'A limiter is a compressor with a very high ratio (10:1 or more) that stops peaks going past the threshold. A noise gate works at the quiet end: it shuts the signal off when it falls below the threshold, cutting hiss and hum between phrases.',
  ], [
    qa('compressor', 'What does a compressor do?', 'Turns the signal down when it goes above the threshold, by an amount set by the ratio.', W(9)),
    mc('ratio', 'A compressor is set to 4:1. The input goes 8 dB over the threshold. How far over is the output?', '2 dB', ['4 dB', '8 dB', '32 dB'], 'At 4:1, every 4 dB in above the threshold comes out as 1 dB.', W(9)),
    qa('attack-release', 'What do attack and release set on a compressor?', 'Attack: how fast it reacts when the level crosses the threshold. Release: how fast it lets go once the level falls back.', W(9)),
    mc('slow-attack', 'A slow attack (say 30 ms) on a guitar compressor tends to…', 'Let the pick attack through, keeping the sound punchy', ['Remove the pick attack entirely', 'Add an echo', 'Raise only the noise'], 'The compressor reacts after the first snap has passed.', W(9)),
    qa('makeup', 'What is make-up gain?', 'Gain added after compression to bring the overall level back up, since compression lowered the peaks.', W(9)),
    mc('limiter', 'What makes a limiter different from a compressor?', 'A very high ratio (10:1 or more), so peaks are held at the threshold', ['It only works on bass', 'It adds gain instead', 'It has no threshold'], 'A limiter is a compressor set to stop peaks, not to shape dynamics gently.', W(9)),
    mc('gate', 'A noise gate…', 'Shuts the signal off when it falls below the threshold', ['Turns loud peaks down', 'Boosts quiet passages', 'Removes one frequency'], 'It cuts hiss and hum in the gaps between phrases.', W(9)),
  ]),
  lesson(22, 5, 'Delay, modulation and reverb', [
    'A delay plays a copy of the sound back a set time later. Long delays (a few hundred milliseconds) are heard as separate echoes; feedback sends some of the output back in for repeats. A single short echo, roughly 75 to 150 ms after the note, is called slapback.',
    'Very short delays are not heard as echoes; mixed with the dry sound (the original, without the effect) they cause comb filtering (from the lesson on adding sounds). Sweep a very short delay, around 1 to 10 ms, up and down and the comb\'s dips move: that is a flanger. A slightly longer, gently wobbling delay, around 10 to 30 ms, makes the copy sound like a second, slightly out-of-step player: that is chorus.',
    'Reverb imitates the dense, fading reflections of a room; its decay time is the same RT60 idea as in a real room. Pre-delay is a short gap before the reverb starts, which keeps the dry sound clear and in front.',
    'An effect shared by several tracks, like one reverb for the whole band, usually sits on an aux (auxiliary) send: each channel sends some of its signal to the effect, and the effect\'s output is mixed back in. An effect that changes one track\'s whole sound, like a compressor, goes on an insert, in line with that one channel.',
  ], [
    qa('delay', 'What does a delay effect do?', 'Plays a copy of the sound back a set time later; feedback sends some of it back in for repeating echoes.', W(11)),
    mc('slapback', 'Slapback is a single echo about how long after the note?', 'Roughly 75 to 150 ms', ['About 1 ms', 'About 1 second', 'About 5 seconds'], 'Short enough to sound like one tight repeat.', W(11)),
    mc('flanger', 'Which effect sweeps a very short delay (about 1 to 10 ms) mixed with the dry sound?', 'A flanger', ['Reverb', 'Slapback', 'A noise gate'], 'The moving delay sweeps the comb filter\'s dips up and down.', W(11)),
    qa('chorus', 'How does chorus make one guitar sound like two?', 'It mixes in a copy delayed by roughly 10 to 30 ms, with the delay gently wobbling, so the copy drifts slightly in pitch and time like a second player.', W(11)),
    mc('pre-delay', 'What does pre-delay on a reverb do?', 'Leaves a short gap before the reverb starts, keeping the dry sound clear', ['Makes the reverb longer', 'Removes low end from the reverb', 'Adds echo repeats'], 'Separating the direct sound from the reverb\'s start helps clarity.', W(11)),
    qa('insert-aux', 'Insert or aux send: which for a compressor on one track, and which for a reverb shared by several tracks?', 'Insert for the compressor (in line with that channel); aux send for the shared reverb (several channels feed it and its output is mixed back in).', W(5)),
  ]),
  lesson(23, 5, 'Digital audio', [
    'Digital recording measures the signal\'s voltage many times a second and stores each measurement as a number. Each measurement is a sample, and the number of samples per second is the sample rate. CDs use 44,100 per second (44.1 kHz); video and much recording use 48 kHz.',
    'A sample rate can capture frequencies up to half its value, called the Nyquist frequency: 22.05 kHz at 44.1 kHz, just above hearing. Anything higher that reached the converter (the part that turns the voltage into numbers) would fold back down as false tones (aliasing), so converters filter it out first.',
    'Bit depth is how many bits (binary digits) each sample uses, which sets how finely the level is measured. Each bit adds about 6 dB of dynamic range, the span from the loudest to the quietest level a system can handle: 16 bits give about 96 dB, 24 bits about 144 dB, more than any real equipment can use.',
    'Digital levels are measured in dBFS (decibels relative to full scale). 0 dBFS is the largest number the system can hold, and going past it clips harshly. At 24 bits there is no need to record near 0 dBFS: peaks 10 to 20 dB below full scale are still far above the noise. Latency is the delay a computer adds while it gathers samples into a buffer: 256 samples at 48 kHz is about 5.3 ms.',
  ], [
    qa('sample', 'What are a sample and the sample rate?', 'A sample is one measurement of the signal\'s level, stored as a number; the sample rate is how many are taken each second.', W(8)),
    mc('nyquist', 'What is the highest frequency 44.1 kHz audio can capture?', '22.05 kHz', ['44.1 kHz', '88.2 kHz', '11 kHz'], 'Half the sample rate: the Nyquist frequency.', W(8)),
    qa('aliasing', 'What is aliasing?', 'Frequencies above half the sample rate folding back down as false tones. Converters filter them out before sampling.', W(8)),
    mc('per-bit', 'About how much dynamic range does each bit add?', 'About 6 dB', ['About 1 dB', 'About 3 dB', 'About 20 dB'], 'Each extra bit doubles the number of levels, and a doubling of voltage is 6 dB.', W(8)),
    mc('sixteen-bit', 'About how much dynamic range does 16-bit audio have?', 'About 96 dB', ['About 16 dB', 'About 48 dB', 'About 144 dB'], '16 × 6 dB ≈ 96 dB.', W(8)),
    qa('dbfs', 'What does 0 dBFS mean?', 'Full scale: the largest level a digital system can hold. Past it the signal clips.', W(8)),
    qa('record-level', 'Why is there no need to record peaks near 0 dBFS at 24 bits?', 'Twenty-four bits leave so much range that peaks 10 to 20 dB below full scale are still far above the noise, and clipping is avoided.', W(8)),
    mc('latency', 'A 256-sample buffer at 48 kHz adds about how much latency?', 'About 5 ms', ['About 0.5 ms', 'About 50 ms', 'About 256 ms'], '256 ÷ 48,000 ≈ 0.0053 s.', W(8)),
  ]),
  lesson(24, 5, 'Recording on tape', [
    'Analogue tape records by magnetizing tiny particles on a moving tape as it passes the record head; the playback head reads the pattern back. A strong, inaudible high-frequency signal called bias is mixed in while recording so the tape responds evenly; without it recordings sound distorted.',
    'Tape hiss is the tape\'s own noise floor. Narrow tracks and slow speed, as on a cassette, put less tape under the signal each second, so the signal sits closer to the hiss than on wide, fast open-reel tape.',
    'Noise reduction fights hiss by changing the signal on the way to tape and undoing the change on playback. dbx compresses the whole signal 2:1 (in dB) with a treble boost when recording and expands it 1:2 on playback: quiet passages go to tape hotter, so the hiss drops when they are restored. When the expander follows a sparse part, the hiss can rise and fall audibly; this is called breathing.',
    'On a multitrack recorder, bouncing means mixing several tracks onto a free one to make room for more parts. Each bounce adds another generation of noise, and the bounced parts cannot be rebalanced later. Heads need care: build-up of the tape\'s magnetic coating (oxide) dulls the highs, a magnetized head adds hiss, and the azimuth (the angle of the head gap to the tape) must be right or high frequencies are lost.',
  ], [
    qa('bias', 'What is bias in tape recording?', 'A strong, inaudible high-frequency signal mixed in while recording so the tape responds evenly; without it recordings sound distorted.', W(6)),
    qa('cassette-hiss', 'Why does a cassette hiss more than wide, fast open-reel tape?', 'Its tracks are narrow and the tape moves slowly, so less tape carries the signal each second and the signal sits closer to the hiss.', W(6)),
    qa('dbx', 'How does dbx noise reduction work?', 'It compresses the signal 2:1 (in dB) with a treble boost when recording and expands it 1:2 on playback. Quiet parts go to tape hotter, so the hiss drops when they are restored.', W(6)),
    mc('dbx-undecoded', 'A dbx-encoded tape played back without dbx sounds…', 'Squashed and too bright', ['Exactly the same', 'Dull and quiet', 'Slower'], 'You hear the recording side\'s compression and treble boost with nothing undoing them.', W(6)),
    mc('breathing', 'Hiss that rises and falls behind a sparse part on a dbx tape is called…', 'Breathing', ['Wow', 'Flutter', 'Print-through'], 'The expander follows the signal, so the hiss under it comes and goes.', W(6)),
    qa('bounce', 'What is bouncing on a multitrack recorder, and what does it cost?', 'Mixing several tracks onto a free one to make room. Each bounce adds a generation of noise, and the bounced parts can no longer be rebalanced.', W(6)),
    qa('azimuth', 'What is azimuth, and what does misalignment do?', 'The angle of the head gap to the tape. If it is off, high frequencies are lost, especially on tapes recorded on another machine.', W(6)),
  ]),
]);

/** Every curriculum card, in teaching order. */
export const LESSON_CARDS: readonly LessonCard[] = Object.freeze(LESSONS.flatMap((l) => l.cards));
const BY_ID = new Map(LESSON_CARDS.map((c) => [c.id, c]));
export const lessonCardById = (id: string): LessonCard | undefined => BY_ID.get(id);
export const lessonByNumber = (n: number): Lesson | undefined => LESSONS[n - 1];
