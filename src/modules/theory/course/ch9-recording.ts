/**
 * Chapter 9: Recording on tape and digital. Last third of the old chapter 5
 * (split 2026-11-13). The tape lesson is kept, built on Blake's 4-track and
 * dbx gear, and split in two so the cassette Extras have a reading; the
 * course now ends on recording guitar at home, not on cassette.
 */
import { G, keep, lesson, LIVE_SRC, mc, qa, W } from '../course-kit.ts';
import type { LessonSpec } from '../course-kit.ts';

export const CH9: readonly LessonSpec[] = [
  lesson('l24', 9, 'Recording on tape', [
    'Analogue tape records by magnetizing tiny particles on a moving tape as it passes the record head; the playback head reads the pattern back. A strong, inaudible high-frequency signal called bias is mixed in while recording so the tape responds evenly; without it recordings sound distorted.',
    'Tape hiss is the tape\'s own noise floor. Narrow tracks and slow speed, as on a cassette, put less tape under the signal each second, so the signal sits closer to the hiss than on wide, fast open-reel tape.',
    'Noise reduction fights hiss by changing the signal on the way to tape and undoing the change on playback. dbx compresses the whole signal 2:1 (in dB) with a treble boost when recording, and expands it 1:2 with a matching treble cut on playback. Quiet passages went to tape hotter, so when the expander turns them back down, the hiss under them goes down too. When the expander follows a sparse part, the hiss can rise and fall audibly; this is called breathing.',
  ], [
    qa('bias', 'What is bias in tape recording?', 'A strong, inaudible high-frequency signal mixed in while recording so the tape responds evenly; without it recordings sound distorted.', W(6)),
    qa('cassette-hiss', 'Why does a cassette hiss more than wide, fast open-reel tape?', 'Its tracks are narrow and the tape moves slowly, so less tape carries the signal each second and the signal sits closer to the hiss.', W(6)),
    qa('dbx', 'What does dbx noise reduction do to the signal when recording?', 'It compresses it 2:1 (in dB) with a treble boost, so quiet parts go to tape hotter.', W(6)),
    qa('dbx-hiss', 'Why does dbx reduce hiss on playback?', 'The playback side expands 1:2 and cuts the treble again: turning the quiet parts back down turns the tape hiss under them down too.', W(6)),
    mc('dbx-undecoded', 'A dbx-encoded tape played back without dbx sounds…', 'Squashed and too bright', ['Exactly the same', 'Dull and quiet', 'Slower'], 'You hear the recording side\'s compression and treble boost with nothing undoing them.', W(6)),
    mc('breathing', 'Hiss that rises and falls behind a sparse part on a dbx tape is called…', 'Breathing', ['Wow', 'Flutter', 'Print-through'], 'The expander follows the signal, so the hiss under it comes and goes.', W(6)),
  ]),
  lesson('l24', 9, 'The cassette 4-track', [
    'A cassette 4-track records four tracks in one direction across the full tape width that a stereo deck splits into two sides, so it uses only one side. Bouncing means mixing several tracks onto a free one to make room for more parts. Each bounce adds another generation of noise, and the bounced parts can no longer be rebalanced.',
    'Cassettes come in types. Type I (normal) is the basic formula. Type II (high bias, such as Maxell XLII) needs more bias when recording and a different playback treble setting, the 70 µs playback EQ (a time constant that sets how much treble is cut on playback); that extra cut lowers hiss, and the tape handles strong highs better. Many decks switch automatically from extra notches in a Type II shell; otherwise set the switch to High or CrO2.',
    'Dolby B and C, the other common noise reduction, rely on the tape being recorded at a matched reference level; dbx compresses evenly across its whole range, so it needs no level calibration. Heads need care: build-up of the tape\'s magnetic coating (oxide) dulls the highs, a magnetized head adds hiss, and the azimuth (the angle of the head gap to the tape) must be right or high frequencies are lost.',
  ], [
    keep('tape-one-side', qa('', 'Why does a 4-track cassette recorder use only one side of the tape?', 'It records all four tracks in one direction across the full tape width that a stereo deck splits into two sides, so there is no second side to flip to.', G('Cassette multitrack format; not from Benade or Winer'))),
    keep('l24-bounce', qa('', 'What is bouncing on a multitrack recorder?', 'Mixing several tracks onto a free one to make room for more parts.', W(6))),
    mc('bounce-cost', 'What does each bounce cost?', 'Another generation of noise, and the bounced parts can no longer be rebalanced', ['Nothing at all, as long as the tape is fresh and clean', 'Tape speed, so the bounced parts play back slower', 'One of the four tracks, which can never be recorded again'], 'Plan bounces so the parts you may want to change come last.', W(6)),
    keep('tape-xlii-type', mc('', 'Maxell XLII is which kind of cassette?', 'Type II (high bias, 70 µs EQ)', ['Type I (normal bias)', 'Type IV (metal)', 'Type III (ferrichrome)'], 'XLII is a high-bias Type II tape.', G('Maxell product specification; not from Benade or Winer'))),
    keep('tape-type2-settings', qa('', 'How should a deck be set for Type II tape like XLII?', 'High bias and 70 µs playback EQ. Many decks switch automatically from the extra notches in a Type II shell; on a machine with a switch, set it to High or CrO2.', G('Cassette type standards; not from Benade or Winer'))),
    keep('tape-type2-vs-1', mc('', 'Compared with Type I tape, Type II tape such as XLII usually gives…', 'Less hiss and more high-frequency headroom', ['More hiss but better bass', 'Exactly the same sound', 'Longer recording time only'], 'The 70 µs playback EQ lowers hiss, and the formulation handles strong highs better.', G('Cassette type standards; not from Benade or Winer'))),
    keep('tape-dbx-cal', qa('', 'Does dbx need level calibration the way Dolby B or C does?', 'No. dbx compresses evenly in dB across its whole range, so it tracks without a matched reference level; Dolby relies on matched levels.', G('dbx and Dolby system behaviour; not from Benade or Winer'))),
    keep('l24-azimuth', qa('', 'What is azimuth on a tape machine?', 'The angle of the head gap to the tape.', W(6))),
    mc('azimuth-off', 'A tape recorded on another machine sounds dull on yours. The likely cause?', 'The two machines\' head azimuth does not match', ['The tape is the wrong length', 'The bias was too low on playback', 'The tape was recorded too quietly'], 'If the head gap is at a different angle, high frequencies are lost.', W(6)),
  ]),
  lesson('l23', 9, 'Digital audio', [
    'Digital recording measures the signal\'s voltage many times a second and stores each measurement as a number. Each measurement is a sample, and the number of samples per second is the sample rate. CDs use 44,100 per second (44.1 kHz); video and much recording use 48 kHz.',
    'A sample rate can capture frequencies up to half its value, called the Nyquist frequency: 22.05 kHz at 44.1 kHz, just above hearing. Anything higher that reached the converter (the part that turns the voltage into numbers) would fold back down as false tones (aliasing), so converters filter it out first.',
    'Bit depth is how many bits (binary digits) each sample uses, which sets how finely the level is measured. Each bit adds about 6 dB of dynamic range, the span from the loudest to the quietest level a system can handle: 16 bits give about 96 dB, 24 bits about 144 dB, more than any real equipment can use.',
    'Digital levels are measured in dBFS (decibels relative to full scale). 0 dBFS is the largest number the system can hold, and going past it clips harshly. At 24 bits there is no need to record near 0 dBFS: peaks 10 to 20 dB below full scale are still far above the noise. Latency is the delay a computer adds while it gathers samples into a buffer: 256 samples at 48 kHz is about 5.3 ms.',
  ], [
    qa('sample', 'In digital audio, what is a sample?', 'One measurement of the signal\'s level, stored as a number.', W(8)),
    mc('sample-rate', 'What is the sample rate?', 'How many samples are taken each second', ['How many bits each sample uses', 'The highest frequency a system can record', 'How long the computer buffers the audio'], 'CDs use 44.1 kHz; much recording uses 48 kHz.', W(8)),
    mc('nyquist', 'What is the highest frequency 44.1 kHz audio can capture?', '22.05 kHz', ['44.1 kHz', '88.2 kHz', '11 kHz'], 'Half the sample rate: the Nyquist frequency.', W(8)),
    qa('aliasing', 'What is aliasing?', 'Frequencies above half the sample rate folding back down as false tones. Converters filter them out before sampling.', W(8)),
    mc('per-bit', 'About how much dynamic range does each bit add?', 'About 6 dB', ['About 1 dB', 'About 3 dB', 'About 20 dB'], 'Each extra bit doubles the number of levels, and a doubling of voltage is 6 dB.', W(8)),
    mc('sixteen-bit', 'About how much dynamic range does 16-bit audio have?', 'About 96 dB', ['About 16 dB', 'About 48 dB', 'About 144 dB'], '16 × 6 dB ≈ 96 dB.', W(8)),
    qa('dbfs', 'What does 0 dBFS mean?', 'Full scale: the largest level a digital system can hold. Past it the signal clips.', W(8)),
    qa('record-level', 'Why is there no need to record peaks near 0 dBFS at 24 bits?', 'Twenty-four bits leave so much range that peaks 10 to 20 dB below full scale are still far above the noise, and clipping is avoided.', W(8)),
    mc('latency', 'A 256-sample buffer at 48 kHz adds about how much latency?', 'About 5 ms', ['About 0.5 ms', 'About 50 ms', 'About 256 ms'], '256 ÷ 48,000 ≈ 0.0053 s.', W(8)),
  ]),
  lesson('rec1', 9, 'Recording guitar at home', [
    'The whole course meets here. A guitar goes into an interface\'s Hi-Z input (or a mic on the cab, or both), its gain is set with room to spare below clipping, and peaks well below 0 dBFS at 24 bits are fine.',
    'Hearing yourself through the computer adds latency. A smaller buffer means less delay but more work for the computer; for tracking, use a small buffer or the interface\'s direct monitoring, which sends the input straight to your headphones with no delay at all.',
    'Record a clean DI track alongside the amp or the amp simulator. Later you can reamp it: send the recorded DI back out through an amp and mic it again, changing the tone after the performance is done. Blending mics, or a mic with the DI, can comb filter, so check the blend in mono, where cancellations show up clearly.',
    'For a wide rhythm sound, play the part twice and pan the two takes left and right: the small differences between real takes make it wide. Copying one take and delaying the copy slightly does not work the same way: it just comb filters.',
  ], [
    mc('direct-monitor', 'You hear yourself late through the computer while recording. What fixes it at once?', 'The interface\'s direct monitoring', ['A larger buffer', 'A higher sample rate on playback only', 'More reverb on the track'], 'Direct monitoring sends the input straight to your headphones, before the computer.', W(8)),
    mc('buffer-size', 'Making the buffer smaller…', 'Lowers latency but makes the computer work harder', ['Raises latency and lowers the work for the computer', 'Improves the sound quality of the recording', 'Changes the sample rate'], 'Small for tracking, larger for mixing.', W(25)),
    qa('record-di', 'Why record a clean DI track alongside the amp?', 'So you can reamp it or change the tone later without playing the part again.', LIVE_SRC),
    qa('reamp', 'What is reamping?', 'Sending a recorded clean DI track back out through an amp and recording it again, to change the tone after the performance.', LIVE_SRC),
    mc('double-track', 'Why do two real takes panned left and right sound wider than one take and a delayed copy?', 'Small differences between real takes sound like two players; a delayed copy just comb filters', ['A delayed copy always drifts out of tune with the original take', 'Two takes are simply louder, and louder always sounds wider', 'Panning only spreads separate takes, never copies of one take'], 'Identical audio offset in time cancels at some frequencies instead of spreading out.', W(7)),
    mc('mono-check', 'Why check a mic and DI blend in mono?', 'Comb filtering and cancellations show up clearly there', ['Mono adds more bass', 'Mono hides clipping', 'The interface records only in mono'], 'Problems that stereo spreads out become obvious when the two are summed.', W(5)),
  ]),
];
