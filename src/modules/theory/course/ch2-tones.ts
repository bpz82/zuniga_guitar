/** Chapter 2: Musical tones. Old lessons 7 to 9; semitone counts and the fret view of intervals added (2026-11-13). */
import { B, keep, lesson, mc, qa, W } from '../course-kit.ts';
import type { LessonSpec } from '../course-kit.ts';

export const CH2: readonly LessonSpec[] = [
  lesson('l07', 2, 'Partials, harmonics and timbre', [
    'Almost no real sound is a single sine wave. A guitar note is many sine waves sounding at once. Each one is called a partial. The lowest is the fundamental, and it usually sets the pitch you hear.',
    'In a guitar string the partials sit at very nearly whole-number multiples of the fundamental (a later lesson on real strings explains the small error). Open A at 110 Hz also has partials at 220, 330, 440, 550 Hz and on up. Partials at whole-number multiples are called harmonics, and the whole set is the harmonic series. The fundamental is the 1st harmonic, 220 Hz the 2nd, and so on. Partials above the fundamental are also called overtones.',
    'Timbre (say "tam-ber") is the colour of a sound: what makes a guitar and a piano playing the same note equally loud sound different. It comes mostly from how strong each partial is, and from how the sound starts (its attack) and fades.',
    'The mix of partials changes while a note rings. In a plucked string the higher partials die away faster than the lower ones, so a note gets darker as it fades.',
  ], [
    qa('partial', 'What is a partial, and what is the fundamental?', 'A partial is one of the sine waves that together make up a sound. The fundamental is the lowest one, and usually sets the pitch.', B(4)),
    mc('multiples', 'The open A string vibrates at 110 Hz. What are its 2nd, 3rd and 4th harmonics?', '220, 330 and 440 Hz', ['220, 440 and 880 Hz', '110, 220 and 330 Hz', '165, 220 and 275 Hz'], 'The nth harmonic is n times the fundamental.', B(5)),
    qa('harmonic', 'What makes a partial a harmonic?', 'Its frequency is a whole-number multiple of the fundamental. Together the harmonics form the harmonic series.', B(5)),
    qa('overtone', 'Is the fundamental an overtone?', 'No. Overtones are the partials above the fundamental. The fundamental is the 1st harmonic, so the 1st overtone is the 2nd harmonic.', B(5)),
    qa('timbre', 'What gives two instruments playing the same note equally loud their different sound?', 'Timbre: mostly the relative strengths of their partials, plus how the sound starts and fades.', B(4)),
    mc('darker', 'Why does a ringing guitar note get darker as it fades?', 'Its higher partials die away faster than its lower ones', ['Its pitch drops slowly as the string loses energy', 'Its fundamental dies away before its higher partials', 'The string stretches and loosens as it keeps ringing'], 'The spectrum tilts toward the fundamental over time.', B(4)),
  ]),
  lesson('l08', 2, 'Intervals and beats', [
    'An interval is the distance in pitch between two notes. The ear hears intervals as ratios of frequency: what matters is how many times higher one note is, not how many hertz apart.',
    'The harmonic series holds the basic intervals of music. Harmonics 1 and 2 (ratio 2:1) are an octave apart. Harmonics 2 and 3 (3:2) make a perfect fifth, 3 and 4 (4:3) a perfect fourth, 4 and 5 (5:4) a major third, and 5 and 6 (6:5) a minor third. Intervals tuned to simple ratios like these are called pure.',
    'Notes a simple ratio apart share many harmonics, which is a big part of why they blend. Play A at 110 Hz with E at 165 Hz (a pure fifth): A\'s 3rd harmonic and E\'s 2nd harmonic are both exactly 330 Hz.',
    'When two tones are close but not equal, their combined loudness swells and fades regularly. These pulses are called beats, and the number per second equals the difference between the two frequencies. Tuning by ear means slowing the beats until they stop.',
  ], [
    qa('interval', 'How does the ear judge the interval between two notes?', 'By the ratio of their frequencies, not by how many hertz apart they are.', B(14)),
    mc('octave-ratio', 'Which frequency ratio is an octave?', '2:1', ['3:2', '4:3', '5:4'], 'An octave doubles the frequency.', B(14)),
    mc('fifth', 'Which interval lies between the 2nd and 3rd harmonics?', 'A perfect fifth (3:2)', ['An octave (2:1)', 'A perfect fourth (4:3)', 'A major third (5:4)'], 'Their frequencies are in the ratio 3:2.', B(14)),
    mc('fourth', 'Which interval lies between the 3rd and 4th harmonics?', 'A perfect fourth (4:3)', ['A perfect fifth (3:2)', 'A major third (5:4)', 'A minor third (6:5)'], 'Their frequencies are in the ratio 4:3.', B(14)),
    qa('thirds', 'Which interval lies between harmonics 4 and 5?', 'A major third (ratio 5:4).', B(14)),
    mc('minor-third', 'Which interval lies between harmonics 5 and 6?', 'A minor third (6:5)', ['A major third (5:4)', 'A perfect fourth (4:3)', 'A whole tone (9:8)'], 'Their frequencies are in the ratio 6:5, a little narrower than the 5:4 major third.', B(14)),
    qa('shared', 'A is 110 Hz and E is 165 Hz. Which frequency do their harmonics share first?', '330 Hz: A\'s 3rd harmonic and E\'s 2nd. Shared harmonics help a fifth blend.', B(14)),
    mc('beats', 'Two tones at 440 Hz and 443 Hz sound together. How many beats per second?', '3', ['443', '1.5', '6'], 'The beat rate is the difference between the two frequencies.', B(14)),
    qa('tune-by-ear', 'When you tune two strings to each other by ear, what are you listening for?', 'The beats between them slowing down. When they stop, the frequencies match.', B(14)),
  ]),
  lesson('l09', 2, 'How we hear pitch: semitones and cents', [
    'Pitch usually follows the fundamental, but the ear works it out from the whole pattern of harmonics. Hear 200, 300 and 400 Hz together with nothing at 100 Hz and you still hear a pitch of 100 Hz: the even spacing of the harmonics gives it away. This is called the missing fundamental.',
    'A semitone is the step from one fret to the next, or from one piano key to the next. Twelve semitones make an octave, so intervals can be counted in frets: a minor third is 3 semitones, a major third 4, a perfect fourth 5, a perfect fifth 7 and an octave 12. A fifth above any note on one string is 7 frets up. Letter names count too: C up to G spans five letters (C, D, E, F, G) and 7 semitones, a perfect fifth.',
    'To measure smaller pitch differences, musicians use cents: an octave is split into 1200 cents, so a semitone is 100 cents. Like decibels for level, cents are ratio steps.',
    'Played one after the other, two notes need to be a few cents apart (around 5) before most people can tell them apart. Played together, beats give away far smaller differences. A tuner reading "+10" means the note is 10 cents sharp (too high); "−10" means 10 cents flat (too low).',
  ], [
    mc('missing', 'You hear partials at 200, 300 and 400 Hz and nothing at 100 Hz. What pitch do you hear?', 'About 100 Hz', ['200 Hz', '300 Hz', 'No clear pitch'], 'The ear infers the common fundamental from the spacing of the harmonics.', B(5)),
    qa('phone-speaker', 'Your phone\'s tiny speaker plays almost nothing below 200 Hz, yet the low E of a song (82 Hz) still has a clear pitch. Why?', 'Its harmonics (164, 246, 328 Hz and up) are still there, and the ear works the pitch out from their spacing.', B(5)),
    qa('semitone', 'What is a semitone on the guitar?', 'The step from one fret to the next on the same string.', B(14)),
    mc('fifth-frets', 'How many semitones (frets on one string) up is a perfect fifth?', '7', ['5', '4', '12'], 'Minor third 3, major third 4, fourth 5, fifth 7, octave 12.', B(14)),
    keep('th-c-to-g', mc('', 'What interval is C up to G?', 'A perfect fifth', ['A perfect fourth', 'A major sixth', 'A major third'], 'Seven semitones: C, D, E, F, G spans five letter names.', B(14))),
    mc('cents-octave', 'How many cents make an octave?', '1200', ['100', '700', '1000'], 'Twelve semitones of 100 cents each.', B(14)),
    mc('tuner', 'A tuner shows −15 for your G string. The string is…', '15 cents flat: tune it up', ['15 cents sharp: tune it down', '15 Hz too low', 'In tune'], 'Minus means below the target pitch.', B(14)),
    mc('smallest-pitch', 'Played one after the other, about how far apart must two notes be for most people to hear a difference?', 'A few cents (around 5)', ['About 50 cents', 'A semitone (100 cents)', 'About 0.01 cents'], 'Played together, beats reveal much smaller differences.', W(3)),
  ]),
];
