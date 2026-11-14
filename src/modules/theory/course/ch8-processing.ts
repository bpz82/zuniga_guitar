/** Chapter 8: Processing. Middle third of the old chapter 5 (split 2026-11-13), with the EQ and compressor lessons split and filled out. */
import { keep, lesson, LIVE_SRC, mc, qa, W } from '../course-kit.ts';
import type { LessonSpec } from '../course-kit.ts';

export const CH8: readonly LessonSpec[] = [
  lesson('l20', 8, 'Guitar frequencies', [
    'In standard tuning the open strings run from low E at about 82 Hz to high E at about 330 Hz, two octaves higher. The highest note on a 22-fret guitar is D at about 1.2 kHz.',
    'Drop D takes the low string down to about 73 Hz; a 7-string\'s low B is about 62 Hz. A bass guitar\'s low E is about 41 Hz, an octave below the guitar\'s.',
    'The harmonics carry the sound far above the fundamentals. Much of what you hear as the low E\'s weight is its 2nd to 4th harmonics (about 165 to 330 Hz), not the 82 Hz fundamental, which is why a guitar still sounds full on small speakers. The pick\'s attack and the presence of a guitar live around 2 to 5 kHz.',
  ], [
    mc('low-e', 'What is the fundamental of the low E string in standard tuning?', 'About 82 Hz', ['About 41 Hz', 'About 110 Hz', 'About 165 Hz'], 'E2 is 82.4 Hz.', W(26)),
    qa('high-e', 'What is the fundamental of the open high E string?', 'About 330 Hz (E4), two octaves above the low E.', W(26)),
    mc('drop-d', 'What is the fundamental of the low string in drop D?', 'About 73 Hz', ['About 82 Hz', 'About 65 Hz', 'About 98 Hz'], 'D2 is 73.4 Hz, a whole step below E2.', W(26)),
    keep('rng-bass', mc('', 'What is the fundamental of a bass guitar\'s low E?', 'About 41 Hz', ['About 82 Hz', 'About 30 Hz', 'About 55 Hz'], 'E1 is 41.2 Hz, one octave below the guitar\'s low E.', W(26))),
    keep('rng-top', qa('', 'What is the highest fundamental on the high E string of a 22-fret guitar?', 'D6, about 1175 Hz. The harmonics above it carry the sound much higher.', W(26))),
    mc('low-e-weight', 'Much of the weight you hear in the low E comes from…', 'Its 2nd to 4th harmonics, about 165 to 330 Hz', ['Its fundamental alone, at 82 Hz', 'Sounds below 40 Hz', 'The pick attack, around 3 kHz'], 'That is why a guitar still sounds full on small speakers that barely reach 82 Hz.', W(26)),
  ]),
  lesson('l20', 8, 'EQ', [
    'An equalizer (EQ) turns frequency ranges up or down. A high-pass filter lets frequencies above its cutoff through and removes those below (it is a low cut).',
    'A low-pass filter does the opposite: it lets the lows through and removes the highs, a high cut.',
    'A shelf raises or lowers everything beyond a corner frequency by the same amount. A bell (peaking) band boosts or cuts around one centre frequency, and its Q sets the width: higher Q, narrower band. A notch is a very narrow, deep cut for one frequency, such as hum or a single ringing note.',
  ], [
    mc('high-pass', 'What does a high-pass filter do?', 'Lets frequencies above its cutoff through and removes those below', ['Boosts frequencies above its cutoff and leaves the rest alone', 'Lets frequencies below its cutoff through and removes those above', 'Removes one narrow band of frequencies around its cutoff'], 'High-pass means the highs pass: it is a low cut.', W(10)),
    mc('low-pass', 'What does a low-pass filter do?', 'Lets frequencies below its cutoff through and removes those above', ['Lets frequencies above its cutoff through and removes those below', 'Boosts everything below its cutoff', 'Removes one narrow band around its cutoff'], 'Low-pass means the lows pass: it is a high cut.', W(10)),
    mc('shelf', 'A shelving EQ…', 'Raises or lowers everything beyond its corner frequency by the same amount', ['Raises or lowers one narrow band around its centre frequency', 'Removes everything below its corner frequency completely', 'Shifts the pitch of everything beyond its corner frequency'], 'The response looks like a shelf: flat, a slope, then flat again at the new level.', W(10)),
    qa('bell', 'What does a bell (peaking) EQ band do?', 'Boosts or cuts around one centre frequency, tapering off either side.', W(10)),
    qa('q', 'What does the Q control on an EQ band set?', 'How wide the band is: higher Q, narrower band.', W(10)),
    keep('eq-notch', qa('', 'What is a notch filter for?', 'A very narrow, deep cut that removes one frequency, such as a hum or a single ringing resonance, while leaving the rest alone.', W(10))),
  ]),
  lesson('l20', 8, 'EQ for guitar in a mix', [
    'A high-pass filter on a guitar track clears rumble and leaves room for the bass guitar and kick drum. Start low, about 60 to 80 Hz, and sweep up until the rumble clears while the low string still sounds solid; a cut at 100 Hz would already be above the low E (82 Hz) and drop D (73 Hz). Drop tunings, 7-strings and baritones need it lower still.',
    'Several instruments make the low mids muddy, so a cut somewhere around 200 to 500 Hz often clears a mix. Around 400 to 800 Hz sounds boxy, around 1 kHz honky, and distorted guitars fizz above about 5 kHz. A gentle lift around 2 to 5 kHz adds presence.',
    'Guitar and voice mask each other: both live in the middle, and the words matter most around 1 to 4 kHz. Cutting the guitar a little there (subtractive EQ: making room by cutting rather than boosting) lets the vocal through without turning anything up.',
  ], [
    qa('guitar-high-pass', 'Where should a high-pass filter on a guitar track start, and how do you set it?', 'Low, about 60 to 80 Hz; sweep up until the rumble clears while the low string still sounds solid. Lower still for drop tunings, 7-strings and baritones.', W(10)),
    mc('hpf-100', 'Why can a fixed 100 Hz high-pass hurt a guitar in drop D?', 'It sits above the low string\'s 73 Hz fundamental', ['It removes the pick attack around 3 kHz', 'It adds rumble below 40 Hz', 'It only works on bass guitar'], 'Low E is 82 Hz and drop D 73 Hz: start the filter lower and sweep up.', W(10)),
    mc('mud', 'Guitar muddiness in a mix is most often around…', '200 to 500 Hz', ['20 to 50 Hz', '2 to 5 kHz', '10 to 15 kHz'], 'Low-mid build-up from several instruments clouds a mix; listen there first.', W(10)),
    keep('rng-presence', qa('', 'Which range is often called guitar presence, and why does it matter?', 'Roughly 2 to 5 kHz: pick attack and articulation live there, and the ear is very sensitive to it.', W(10))),
    mc('boxy', 'A guitar sounds boxy. Where would you look first?', 'Around 400 to 800 Hz', ['Around 60 to 80 Hz', 'Around 2 to 5 kHz', 'Above 10 kHz'], 'Boxy is the lower mids; honky is near 1 kHz; fizz is above about 5 kHz.', LIVE_SRC),
    mc('fizz', 'A heavily distorted guitar sounds fizzy. Which range is the usual culprit?', 'Above about 5 kHz', ['Around 100 Hz', 'Around 300 Hz', 'Around 1 kHz'], 'A gentle low-pass or high shelf cut there tames it; a 12-inch speaker does much of this already.', LIVE_SRC),
    qa('vocal-carve', 'The guitar is burying the vocal. What does subtractive EQ suggest?', 'Cut the guitar a little where the words live, around 1 to 4 kHz, so the voice comes through without turning anything up.', W(10)),
  ]),
  lesson('l21', 8, 'Compressors', [
    'Dynamics are the changes in level within a performance, from soft to loud. Dynamics processors control them automatically.',
    'A compressor turns the signal down when it goes above a set level, the threshold. The ratio says how much: at 4:1 a signal 8 dB over the threshold comes out only 2 dB over. Attack is how fast it reacts once the level crosses the threshold; release is how fast it lets go once the level falls back. Because compression lowers the peaks, make-up gain raises the whole signal back up afterwards.',
    'A slow attack lets the pick\'s first snap through before the compressor clamps down, keeping punch. A very fast release can make the level pump audibly or distort low notes; a very slow one keeps the sound squashed.',
  ], [
    qa('compressor', 'What does a compressor do?', 'Turns the signal down when it goes above the threshold, by an amount set by the ratio.', W(9)),
    qa('threshold', 'What is a compressor\'s threshold?', 'The level above which it starts turning the signal down.', W(9)),
    mc('ratio', 'A compressor is set to 4:1. The input goes 8 dB over the threshold. How far over is the output?', '2 dB', ['4 dB', '8 dB', '32 dB'], 'At 4:1, every 4 dB in above the threshold comes out as 1 dB.', W(9)),
    qa('attack-release', 'What does attack set on a compressor?', 'How fast it reacts when the level crosses the threshold.', W(9)),
    qa('release', 'What does release set on a compressor, and what goes wrong at the extremes?', 'How fast it lets go once the level falls back. Too fast can pump or distort low notes; too slow keeps the sound squashed.', W(9)),
    mc('slow-attack', 'A slow attack (say 30 ms) on a guitar compressor tends to…', 'Let the pick attack through, keeping the sound punchy', ['Remove the pick attack entirely, for a softer start', 'Add a short echo after each picked note', 'Raise only the noise, leaving the notes alone'], 'The compressor reacts after the first snap has passed.', W(9)),
    qa('makeup', 'What is make-up gain?', 'Gain added after compression to bring the overall level back up, since compression lowered the peaks.', W(9)),
  ]),
  lesson('l21', 8, 'Limiters, gates and compressor pedals', [
    'A limiter is a compressor with a very high ratio (10:1 or more) that stops peaks going past the threshold. A noise gate works at the quiet end: it shuts the signal off when it falls below its threshold. Set too high, it chops off the tails of fading notes.',
    'A compressor pedal is also a sustain tool: as a note fades, the compressor turns it up, so it rings longer at an even level. Clean country and funk players use it for even, snappy picking.',
    'Compressor pedals hiss because of make-up gain: bringing the quiet parts up raises the noise floor with them, and in the gaps between notes there is nothing but noise to raise.',
  ], [
    mc('limiter', 'What makes a limiter different from a compressor?', 'A very high ratio (10:1 or more), so peaks are held at the threshold', ['It only works on bass frequencies', 'It adds gain instead of reducing it', 'It has no threshold at all'], 'A limiter is a compressor set to stop peaks, not to shape dynamics gently.', W(9)),
    mc('gate', 'A noise gate…', 'Shuts the signal off when it falls below the threshold', ['Turns the signal down when it rises above the threshold', 'Boosts quiet passages until they reach the threshold', 'Removes one narrow frequency, such as hum'], 'It cuts hiss and hum in the gaps between phrases.', W(9)),
    mc('gate-too-high', 'A noise gate\'s threshold is set too high. What happens?', 'It chops off the fading tails of notes', ['It lets more hiss through', 'It makes every note louder', 'It adds a short echo'], 'The note falls below the threshold while still ringing, and the gate shuts it off.', W(9)),
    qa('pedal-hiss', 'Why does a compressor pedal often hiss?', 'Its make-up gain raises the quiet parts, and the noise floor with them; between notes there is only noise to raise.', W(9)),
    mc('comp-sustain', 'How does a compressor pedal add sustain?', 'As a note fades, it turns the note up, so it rings longer at an even level', ['It makes the string vibrate harder', 'It adds a looped copy of the note', 'It lowers the pitch slightly, and low notes ring longer'], 'The fading note is held near the threshold level until it is almost gone.', W(9)),
    mc('limit-use', 'Which job suits a limiter best?', 'Stopping occasional peaks going past a set level', ['Gently evening out a whole performance', 'Cutting hiss between phrases', 'Removing a single ringing frequency'], 'A very high ratio holds peaks at the threshold.', W(9)),
  ]),
  lesson('l22', 8, 'Reverb and routing in the mix', [
    'Reverb imitates the dense, fading reflections of a room; its decay time is the same RT60 idea as in a real room. Pre-delay is a short gap before the reverb starts, which keeps the dry sound clear and in front. Too much reverb, or too long a decay, washes a guitar part into the background.',
    'An effect shared by several tracks, like one reverb for the whole band, usually sits on an aux send: each channel sends some of its signal to the effect, and the effect\'s output is mixed back in. Effects sends are usually post-fader, so a channel\'s reverb follows its fader.',
    'An effect that changes one track\'s whole sound, like a compressor, goes on an insert, in line with that one channel.',
  ], [
    mc('pre-delay', 'What does pre-delay on a reverb do?', 'Leaves a short gap before the reverb starts, keeping the dry sound clear', ['Makes the reverb tail last longer before it dies away', 'Removes low end from the reverb so it sounds clearer', 'Adds separate echo repeats before the reverb begins'], 'Separating the direct sound from the reverb\'s start helps clarity.', W(11)),
    qa('reverb-decay', 'What does a reverb\'s decay time measure?', 'How long its tail takes to die away, the same RT60 idea as in a real room.', W(11)),
    qa('insert-aux', 'Insert or aux send: where does a compressor for one track go?', 'On an insert, in line with that one channel.', W(5)),
    mc('aux-reverb', 'One reverb shared by several tracks goes on…', 'An aux send', ['An insert on each channel', 'The master fader', 'The first stage of the preamp'], 'Each channel sends some signal to it, and its output is mixed back in.', W(5)),
    mc('post-fader', 'Why are effects sends usually post-fader?', 'So a channel\'s reverb follows its fader up and down', ['So the reverb ignores the fader', 'So the monitors hear the reverb only', 'So the reverb comes before the EQ'], 'Pre-fader suits monitor mixes; post-fader keeps the wet and dry balance as you mix.', W(5)),
    mc('wash', 'A guitar part sounds distant and blurred in the mix. Which reverb change helps most?', 'Shorter decay or less reverb, with some pre-delay', ['A longer decay', 'More reverb and no pre-delay', 'Moving the reverb to an insert on every track'], 'Too much or too long a tail washes the part into the background.', W(11)),
  ]),
];
