/**
 * The Michael Jackson knowledge base.
 *
 * Every track the app can ever suggest lives here with a real emotional
 * profile, expressed in the same four axes the mood analyzer produces:
 *
 *   v  valence      -1 broken .. +1 radiant
 *   a  arousal       0 still  ..  1 explosive
 *   d  danceability  0 ballad ..  1 floor-filler
 *   w  warmth        0 cold   ..  1 comforting
 *
 * This file describes FEELINGS ONLY. It never maps a mood to a song. The
 * recommender ranks these by distance in that space.
 *
 * `buildCatalog(files)` intersects this knowledge base with the audio files
 * actually present on disk, so the app only ever suggests songs it can play.
 *
 * `music` data drives the generated arrangement used when a file is missing.
 */

/* ------------------------------------------------------------------ tuples */

// title | album | year | key | bpm | scale | groove | v | a | d | w | themes | note | feel | aliases
const T = [
  // ---------------------------------------------------------------- early solo
  ['Got to Be There', 'Got to Be There', 1971, 'Bb', 88, 'major', 'motown', 0.70, 0.50, 0.65, 0.70, 'love,hope', 'His first solo single, still in the Jackson 5\u2019s shadow.', 'A kid being brave about a feeling bigger than he is.'],
  ["Rockin' Robin", 'Got to Be There', 1972, 'C', 96, 'major', 'motown', 0.88, 0.82, 0.90, 0.70, 'joy,playfulness,celebration', 'A cover of Bobby Day\u2019s 1958 rock and roll novelty hit.', 'No subtext, no ache, just a grin and a shuffle.'],
  ['Ben', 'Ben', 1972, 'G', 78, 'major', 'ballad', 0.30, 0.30, 0.40, 0.85, 'friendship,loneliness,compassion', 'A love song to a rat, written for a horror sequel, and it won a Golden Globe.', 'The relief of being understood by the one friend who stayed.'],
  ['One Day in Your Life', 'Forever, Michael', 1975, 'C', 72, 'major', 'ballad', 0.20, 0.30, 0.40, 0.80, 'nostalgia,loss,love', 'Barely noticed in 1975, a top ten in the UK six years later.', 'Looking back at something soft that already ended.'],
  ['I Want You Back', 'Diana Ross Presents The Jackson 5', 1969, 'Ab', 98, 'major', 'motown', 0.90, 0.85, 0.95, 0.80, 'joy,love,hope,nostalgia', 'A 10-year-old takes the first verse and never gives it back.', 'The sun coming up on a day that has not gone wrong yet.'],
  ['ABC', 'ABC', 1970, 'Ab', 96, 'major', 'motown', 0.92, 0.88, 0.96, 0.78, 'joy,celebration,playfulness', 'A spelling lesson that outsold most love songs that year.', 'Pure playground adrenaline, no complications attached.'],
  ["I'll Be There", 'Third Album', 1970, 'F', 74, 'major', 'ballad-motown', 0.82, 0.38, 0.50, 0.95, 'love,compassion,friendship,hope', 'The first Motown single to open at number one by a group.', 'Someone quietly promising to stay, and meaning every word.'],
  ['Never Can Say Goodbye', 'Maybe Tomorrow', 1971, 'Bb', 92, 'minor', 'ballad', -0.50, 0.45, 0.50, 0.60, 'loss,love,nostalgia', 'A goodbye song that refuses to actually say goodbye.', 'Standing in the doorway, unable to close the door.'],
  ['We Are the World', 'USA for Africa', 1985, 'C', 78, 'major', 'epoch', 0.80, 0.55, 0.40, 0.95, 'unity,compassion,hope', 'Co-written overnight and recorded by 45 artists after the AMAs.', 'Hoping that everyone together might actually be enough.'],

  // ------------------------------------------------------------- Off the Wall
  ["Don't Stop 'Til You Get Enough", 'Off the Wall', 1979, 'Bm', 122, 'minor', 'disco', 0.92, 0.92, 0.97, 0.75, 'joy,celebration,desire', 'His first solo writing credit and his first solo number one.', 'The exact moment the floor stops being a floor.'],
  ['Rock with You', 'Off the Wall', 1979, 'Db', 114, 'major', 'disco', 0.88, 0.72, 0.92, 0.88, 'love,desire,joy', 'Recorded in one take, warmth turned into a groove.', 'Close enough to hear someone breathe and not wanting them to move.'],
  ['Off the Wall', 'Off the Wall', 1979, 'Em', 122, 'minor', 'disco', 0.80, 0.88, 0.95, 0.60, 'celebration,escapism,joy', 'The album that made him a solo star instead of a former child star.', 'Leaving your own problems somewhere behind the bassline.'],
  ["She's Out of My Life", 'Off the Wall', 1979, 'C', 66, 'minor', 'ballad', -0.90, 0.35, 0.20, 0.70, 'loss,grief,loneliness', 'He cried in the vocal booth and they kept the take.', 'The silence after a door closes, and knowing it is real.'],
  ["Workin' Day and Night", 'Off the Wall', 1979, 'Bb', 120, 'minor', 'funk', 0.55, 0.85, 0.90, 0.50, 'resilience,weariness,defiance', 'He wrote and arranged it himself at twenty.', 'Grinding through it anyway because stopping is not an option.'],
  ['Girlfriend', 'Off the Wall', 1979, 'Ab', 120, 'major', 'pop', 0.80, 0.72, 0.85, 0.70, 'playfulness,love,desire', 'Written by Paul McCartney as a gift, produced by Quincy Jones.', 'A wink, a shrug, and someone new on your mind.'],
  ['Get on the Floor', 'Off the Wall', 1979, 'Em', 124, 'minor', 'disco', 0.82, 0.88, 0.96, 0.65, 'celebration,desire,joy', 'A co-write with Louis Johnson of the Brothers Johnson.', 'The bassline doing most of the talking and all of the flirting.'],
  ['Burn This Disco Out', 'Off the Wall', 1979, 'Fm', 118, 'minor', 'disco', 0.85, 0.90, 0.97, 0.65, 'celebration,joy,escapism', 'The closing track, and the most relentless thing on the record.', 'Dancing like the night is being scored to it.'],
  ["I Can't Help It", 'Off the Wall', 1979, 'A', 92, 'major', 'ballad', 0.72, 0.42, 0.62, 0.85, 'love,awe,sensuality', 'Written by Stevie Wonder, who plays the keys.', 'Being quietly undone by someone and not minding at all.'],
  ["It's the Falling in Love", 'Off the Wall', 1979, 'C', 106, 'major', 'disco', 0.78, 0.70, 0.85, 0.80, 'love,joy,comfort', 'A duet with Patti Austin, tucked near the end.', 'The easy, floating part of falling for someone.'],
  ['Sunset Driver', 'Off the Wall', 1979, 'Am', 128, 'minor', 'funk', 0.72, 0.82, 0.92, 0.60, 'celebration,escapism,desire', 'An Off the Wall outtake, released decades later.', 'Top down, engine running, nowhere to be until morning.'],

  // ------------------------------------------------------------------ Thriller
  ["Wanna Be Startin' Somethin'", 'Thriller', 1982, 'Em', 122, 'minor', 'funk', 0.50, 0.93, 0.96, 0.50, 'defiance,tension,celebration', 'Opens Thriller with a 90-second chant that refuses to settle.', 'Too much energy to sit still and too much edge to relax.'],
  ['Baby Be Mine', 'Thriller', 1982, 'F', 118, 'major', 'funk', 0.82, 0.68, 0.88, 0.82, 'love,desire', 'The deep cut Thriller fans argue about most.', 'Easy desire, no danger in it at all.'],
  ['The Girl Is Mine', 'Thriller', 1982, 'C', 92, 'major', 'ballad', 0.70, 0.45, 0.60, 0.80, 'playfulness,love', 'The McCartney duet where they argue over a girl like schoolkids.', 'Gentle, funny, and completely unserious about itself.'],
  ['Thriller', 'Thriller', 1982, 'C#m', 118, 'minor', 'funk', -0.15, 0.90, 0.90, 0.35, 'fear,escapism,celebration', 'The only pop song that turned a horror movie voiceover into a dance routine.', 'Being deliciously scared because you know it is only a ride.'],
  ['Beat It', 'Thriller', 1982, 'Em', 138, 'minor', 'rock', 0.25, 0.95, 0.85, 0.40, 'defiance,anger,resilience', 'The Eddie Van Halen solo nobody was supposed to know about.', 'Walking away from a fight you could win, on your own terms.'],
  ['Billie Jean', 'Thriller', 1982, 'F#m', 117, 'minor', 'funk', -0.55, 0.78, 0.92, 0.35, 'paranoia,tension,obsession', 'The bassline that made Quincy Jones want to kill the drummer.', 'A secret following you home that will not take no for an answer.'],
  ['Human Nature', 'Thriller', 1982, 'A', 92, 'major', 'ballad', -0.05, 0.30, 0.50, 0.75, 'melancholy,reflection,nostalgia', 'Written for Toto, kept for Thriller, and he fought to keep it.', 'A late drive with the windows down and nowhere to be.'],
  ['P.Y.T.', 'Thriller', 1982, 'Bm', 128, 'major', 'funk', 0.85, 0.82, 0.93, 0.72, 'joy,desire,playfulness', 'Stands for Pretty Young Thing, and he built the synth bed himself.', 'Flirting at full volume with absolutely no restraint.', 'p y t pretty young thing,pyt pretty young thing,pretty young thing'],
  ['The Lady in My Life', 'Thriller', 1982, 'Ab', 70, 'major', 'ballad', 0.85, 0.35, 0.50, 0.95, 'love,desire,compassion', 'The quiet closer of the biggest album ever made.', 'Saying the tender thing out loud, slowly, and staying.'],
  ['Carousel', 'Thriller', 1982, 'C', 84, 'major', 'ballad', 0.45, 0.55, 0.65, 0.80, 'love,awe,nostalgia', 'A Thriller outtake that surfaced on later reissues.', 'A fairground ride that feels like a memory while it is happening.'],
  ["Can't Get Outta the Rain", 'Thriller', 1982, 'A', 96, 'major', 'ballad', -0.10, 0.45, 0.60, 0.60, 'melancholy,reflection,weariness', 'The B-side of The Girl Is Mine.', 'Standing in bad weather you cannot talk your way out of.'],
  ["She's Trouble", 'Thriller', 1982, 'Am', 122, 'minor', 'funk', -0.25, 0.72, 0.82, 0.45, 'playfulness,frustration,desire', 'A Thriller-era demo credited to Bill Bottrell.', 'Knowing better and going anyway, with a grin.'],
  ['Thriller (Steve Aoki Midnight Hour Remix)', 'Thriller 25', 2008, 'C#m', 128, 'minor', 'disco', 0.10, 0.95, 0.96, 0.40, 'fear,celebration,celebration', 'The remix that put Thriller back on dancefloors 25 years later.', 'The same horror story, told at four in the morning.', 'thriller steve aoki midnight hour remix,thriller steve aoki remix'],

  // ----------------------------------------------------------------------- Bad
  ['Bad', 'Bad', 1987, 'Am', 114, 'minor', 'funk', 0.35, 0.88, 0.92, 0.45, 'defiance,confidence,tension', 'The 18-minute short film that changed what a music video could be.', 'Proving something to someone who stopped listening years ago.'],
  ['The Way You Make Me Feel', 'Bad', 1987, 'E', 114, 'major', 'funk', 0.85, 0.78, 0.93, 0.78, 'desire,love,celebration', 'The shimmy on the street that took a whole day to shoot.', 'The giddy, undignified joy of wanting someone who is right there.'],
  ['Speed Demon', 'Bad', 1987, 'Am', 158, 'minor', 'rock', -0.20, 0.95, 0.85, 0.30, 'tension,escapism,restlessness', 'The claymation chase that followed the Bad video.', 'Too fast to think, and choosing to keep going faster.'],
  ['Liberian Girl', 'Bad', 1987, 'C', 84, 'major', 'ballad', 0.80, 0.40, 0.60, 0.90, 'love,compassion,awe', 'The video had 40 celebrities waiting to say one line to camera.', 'Loving someone from far away, gently and without demands.'],
  ['Another Part of Me', 'Bad', 1987, 'C', 122, 'major', 'funk', 0.82, 0.85, 0.92, 0.70, 'unity,confidence,hope', 'A Captain EO song that outgrew the theme park.', 'Realising you belong to something larger and it feels good.'],
  ['Man in the Mirror', 'Bad', 1987, 'G', 100, 'major', 'epoch', 0.45, 0.60, 0.50, 0.85, 'reflection,hope,guilt,compassion', 'He stopped mid-session, told everyone to leave, and finished it alone.', 'Turning to face yourself and deciding to actually change.'],
  ["I Just Can't Stop Loving You", 'Bad', 1987, 'D', 76, 'major', 'ballad', 0.82, 0.38, 0.50, 0.95, 'love,devotion', 'The first single from Bad, a duet with Siedah Garrett.', 'A promise that does not waver, even when it probably should.', '', 'Siedah Garrett'],
  ['Dirty Diana', 'Bad', 1987, 'Gm', 132, 'minor', 'rock', -0.45, 0.90, 0.88, 0.30, 'obsession,desire,tension', 'Diana Ross reportedly told him she loved it.', 'Wanting the thing you already know is a bad idea.'],
  ['Smooth Criminal', 'Bad', 1987, 'Am', 118, 'minor', 'funk', -0.35, 0.85, 0.93, 0.30, 'tension,intrigue,obsession', 'That forward lean was done with a hidden harness and a lot of practice.', 'Piecing together what happened in a room you never saw.'],
  ['Leave Me Alone', 'Bad', 1987, 'Em', 128, 'minor', 'funk', -0.60, 0.88, 0.90, 0.25, 'anger,defiance,alienation', 'A middle finger to the tabloids, delivered as a fairground ride.', 'Being talked about so much you stop feeling like a person.'],
  ['Just Good Friends', 'Bad', 1987, 'A', 104, 'major', 'pop', 0.45, 0.65, 0.80, 0.62, 'playfulness,reflection,friendship', 'A Stevie Wonder duet about a romance that fizzled into friendship.', 'Being grown-up about it, mostly, and only slightly annoyed.'],
  ['Bad (Shortened Version)', 'Bad', 1987, 'Am', 114, 'minor', 'funk', 0.35, 0.88, 0.92, 0.45, 'defiance,confidence', 'The single edit of the Bad short film.', 'The same swagger, trimmed for radio.', 'bad shortened version'],

  // ----------------------------------------------------------------- Dangerous
  ['Jam', 'Dangerous', 1991, 'Bm', 116, 'minor', 'funk', -0.35, 0.90, 0.95, 0.30, 'urgency,frustration,defiance', 'A Heavy D rap and a basketball court, and the album opens.', 'Panic with a beat, or a beat that keeps panic at bay.'],
  ['Why You Wanna Trip on Me', 'Dangerous', 1991, 'Gm', 118, 'minor', 'funk', -0.65, 0.85, 0.88, 0.25, 'anger,injustice,defiance', 'Directed at a world obsessed with his life and blind to its own.', 'The exhaustion of being judged while nobody looks at themselves.'],
  ['In the Closet', 'Dangerous', 1991, 'Cm', 112, 'minor', 'funk', 0.30, 0.72, 0.88, 0.45, 'desire,tension,intrigue', 'Credited to Mystery Girl, who turned out to be Princess Stephanie.', 'Something you want that you are not supposed to want out loud.'],
  ['She Drives Me Wild', 'Dangerous', 1991, 'Em', 124, 'minor', 'funk', 0.20, 0.88, 0.93, 0.40, 'desire,tension,urgency', 'Built on a drum loop and a car-engine sample.', 'Wanting someone so loudly it drowns out everything else.'],
  ["Can't Let Her Get Away", 'Dangerous', 1991, 'Bm', 106, 'minor', 'funk', -0.35, 0.75, 0.88, 0.40, 'longing,desire,loss', 'A Teddy Riley production with a very long fade.', 'Holding on past the point where it is good for you.'],
  ['Remember the Time', 'Dangerous', 1991, 'C', 108, 'major', 'funk', 0.70, 0.60, 0.85, 0.80, 'nostalgia,love,loss', 'The nine-minute desert court video with Eddie Murphy and Iman.', 'Missing someone from a time that felt easier than now.'],
  ['Heal the World', 'Dangerous', 1991, 'A', 78, 'major', 'epoch', 0.78, 0.45, 0.40, 0.95, 'compassion,hope,unity', 'He founded a charity with the same name the year it came out.', 'Wanting, very simply, for the world to stop hurting itself.'],
  ['Black or White', 'Dangerous', 1991, 'E', 116, 'major', 'rock', 0.72, 0.80, 0.92, 0.78, 'unity,joy,defiance', 'The morphing faces segment pulled the video from some networks.', 'Loud, joyful refusal to accept a line between people.'],
  ['Who Is It', 'Dangerous', 1991, 'Em', 108, 'minor', 'funk', -0.78, 0.65, 0.82, 0.35, 'betrayal,loss,heartbreak', 'Dedicated to his mother, and one of his own favourites.', 'The floor dropping when you realise who it was all along.'],
  ['Give In to Me', 'Dangerous', 1991, 'Gm', 128, 'minor', 'rock', -0.55, 0.88, 0.80, 0.30, 'anger,desire,tension', 'Slash on guitar, and a vocal that sounds genuinely unhinged.', 'Wrestling with something that is winning.'],
  ['Will You Be There', 'Dangerous', 1991, 'F', 82, 'major', 'epoch', 0.60, 0.45, 0.40, 0.92, 'faith,comfort,loneliness,hope', 'The Free Willy theme, with a spoken outro taken from his own poem.', 'Asking, quietly, to be held, and half-expecting no.'],
  ['Keep the Faith', 'Dangerous', 1991, 'E', 118, 'major', 'epoch', 0.78, 0.78, 0.70, 0.75, 'resilience,faith,hope', 'A gospel choir he assembled and directed himself.', 'Standing back up because someone told you it was still possible.'],
  ['Gone Too Soon', 'Dangerous', 1991, 'C', 66, 'major', 'ballad', -0.85, 0.30, 0.20, 0.90, 'grief,loss,compassion', 'Written for Ryan White and performed at Bill Clinton\u2019s inauguration.', 'The particular ache of a life that ended far too early.'],
  ['Dangerous', 'Dangerous', 1991, 'Dm', 118, 'minor', 'funk', -0.20, 0.88, 0.93, 0.35, 'intrigue,tension,desire', 'The title track was released as a single eight years later.', 'The pull of something that is clearly trouble.'],

  // ------------------------------------------------------------------- HIStory
  ['Scream', 'HIStory', 1995, 'Bm', 102, 'minor', 'funk-rock', -0.80, 0.92, 0.85, 0.25, 'anger,frustration,defiance', 'The most expensive music video ever made, with Janet.', 'Fury that finally found a rhythm instead of a wall.', '', 'Janet Jackson'],
  ["They Don't Care About Us", 'HIStory', 1995, 'Bm', 90, 'minor', 'funk', -0.72, 0.88, 0.90, 0.35, 'anger,injustice,defiance', 'The lyrics were edited in some pressings; he called the edits antisemitic.', 'The roar of being failed by a system and saying so anyway.'],
  ['Stranger in Moscow', 'HIStory', 1995, 'Am', 80, 'minor', 'ballad', -0.82, 0.35, 0.40, 0.55, 'alienation,loneliness,melancholy', 'Written in a Moscow hotel room during a very bad week.', 'Rain on a window in a city where nobody knows your name.'],
  ['This Time Around', 'HIStory', 1995, 'Bm', 122, 'minor', 'funk', -0.60, 0.80, 0.85, 0.25, 'betrayal,anger,cynicism', 'A Notorious B.I.G. verse sits in the middle of it.', 'Done being nice about it, and saying so plainly.'],
  ['Earth Song', 'HIStory', 1995, 'Ab', 70, 'minor', 'epoch', -0.50, 0.55, 0.30, 0.90, 'grief,urgency,compassion', 'The UK Christmas number one, and never a US single.', 'Grief for something being lost that cannot argue back.'],
  ['D.S.', 'HIStory', 1995, 'Am', 116, 'minor', 'funk-rock', -0.80, 0.85, 0.82, 0.20, 'anger,injustice,defiance', 'A blunt, furious character assassination set to a hard rock riff.', 'Rage with a name attached to it.'],
  ['Money', 'HIStory', 1995, 'Am', 120, 'minor', 'funk', -0.60, 0.80, 0.85, 0.25, 'cynicism,anger', 'Opens with a recording of a slot machine.', 'Watching people choose the cash and stop pretending otherwise.'],
  ['You Are Not Alone', 'HIStory', 1995, 'Bb', 76, 'major', 'ballad', 0.55, 0.38, 0.50, 0.95, 'comfort,hope,loneliness', 'The only song to debut at number one on the Hot 100 until 1997.', 'Someone reaching for your hand in the dark, and finding it.'],
  ['Childhood', 'HIStory', 1995, 'C', 68, 'major', 'ballad', -0.35, 0.30, 0.30, 0.88, 'vulnerability,nostalgia,sadness', 'The one he wanted people to hear before they judged him.', 'Explaining a wound you never chose and cannot fully describe.'],
  ['Tabloid Junkie', 'HIStory', 1995, 'Bm', 116, 'minor', 'funk', -0.70, 0.85, 0.88, 0.20, 'anger,alienation,defiance', 'An argument with the press, spelled out in the liner notes.', 'Reading a lie about yourself and feeling your jaw tighten.'],
  ['2 Bad', 'HIStory', 1995, 'Bm', 118, 'minor', 'funk', -0.40, 0.90, 0.90, 0.30, 'defiance,anger', 'A rapper, a boxer, and a very fast bassline.', 'Telling someone to bring it, because you are done flinching.'],
  ['HIStory', 'HIStory', 1995, 'Cm', 84, 'minor', 'epoch', -0.10, 0.50, 0.45, 0.75, 'reflection,hope,melancholy', 'The song the album is named after, more question than statement.', 'Trying to work out what any of it was for.', 'history'],
  ['Little Susie', 'HIStory', 1995, 'Gm', 62, 'minor', 'ballad', -0.90, 0.35, 0.15, 0.85, 'tragedy,grief,compassion', 'Built on a melody he had hummed since childhood.', 'The stillness of something unthinkably sad and very small.', 'little susie pie jesu,little susie \u29f8 pie jesu'],
  ['Come Together', 'HIStory', 1995, 'Bm', 96, 'minor', 'funk-rock', 0.65, 0.62, 0.75, 0.75, 'unity,hope,playfulness', 'A Beatles cover recorded for the Moonwalker film.', 'A crowd of people finding the same groove at the same time.'],
  ['On the Line', 'Ghosts', 1997, 'Am', 96, 'minor', 'ballad', 0.30, 0.50, 0.55, 0.80, 'hope,resilience,reflection', 'The closing song from the Ghosts film.', 'Stepping back into your own life on purpose.'],

  // ------------------------------------------ Blood on the Dance Floor / Ghosts
  ['Blood on the Dance Floor', 'Blood on the Dance Floor', 1997, 'Fm', 124, 'minor', 'disco', -0.30, 0.90, 0.95, 0.30, 'tension,desire,obsession', 'The best-selling remix album of all time.', 'Something dangerous wearing dancing shoes.'],
  ['Blood on the Dance Floor 2017', 'Blood on the Dance Floor 2017', 2017, 'Fm', 124, 'minor', 'disco', -0.20, 0.92, 0.94, 0.35, 'tension,renewal,obsession', 'A 2017 rework built for contemporary dancefloors.', 'The same danger, twenty years newer.'],
  ['Blood on the Dance Floor x Dangerous', 'Blood on the Dance Floor x Dangerous', 2017, 'Fm', 126, 'minor', 'disco', -0.25, 0.93, 0.94, 0.30, 'tension,intrigue,obsession', 'A mash-up of Blood on the Dance Floor with Dangerous.', 'Two bad ideas colliding on purpose.'],
  ['Ghosts', 'Blood on the Dance Floor', 1997, 'Gm', 110, 'minor', 'funk-rock', -0.45, 0.82, 0.80, 0.30, 'fear,alienation,tension', 'He wrote, directed and choreographed the short film himself.', 'Being the thing everyone is frightened of and not knowing why.'],
  ['Is It Scary', 'Blood on the Dance Floor', 1997, 'Fm', 116, 'minor', 'funk-rock', -0.55, 0.78, 0.78, 0.30, 'fear,alienation,vulnerability', 'A song about being the monster in other people\u2019s stories.', 'Asking whether you are frightening or just frightened.'],
  ['Morphine', 'Blood on the Dance Floor', 1997, 'Cm', 122, 'minor', 'funk-rock', -0.75, 0.88, 0.80, 0.20, 'tension,anguish,intensity', 'A jarring, genuinely unsettling industrial track.', 'A nerve that will not stop firing.'],

  // ---------------------------------------------------------------- Invincible
  ['Unbreakable', 'Invincible', 2001, 'Bm', 100, 'minor', 'funk', 0.50, 0.80, 0.90, 0.50, 'resilience,confidence,defiance', 'Opens Invincible with a Biggie verse cleared after his death.', 'Scarred, and entirely unwilling to be finished off.'],
  ['Heartbreaker', 'Invincible', 2001, 'Bm', 112, 'minor', 'funk', -0.55, 0.82, 0.90, 0.35, 'heartbreak,anger,betrayal', 'A beat built to sound like a text message going unanswered.', 'The anger that arrives right after the sadness.'],
  ['Invincible', 'Invincible', 2001, 'Em', 116, 'minor', 'funk', 0.60, 0.85, 0.90, 0.55, 'confidence,resilience', 'The title track, never released as a single.', 'Knowing exactly who you are and refusing to argue about it.'],
  ['Break of Dawn', 'Invincible', 2001, 'C', 108, 'major', 'ballad', 0.85, 0.45, 0.60, 0.90, 'sensuality,love,peace', 'A soft landing two songs into the album.', 'Waking up next to someone with nowhere to be.'],
  ['Heaven Can Wait', 'Invincible', 2001, 'Eb', 90, 'major', 'ballad', 0.25, 0.45, 0.50, 0.90, 'longing,love,devotion', 'One of the most-covered songs he wrote late in his career.', 'Bargaining for a little more time with someone you love.'],
  ['You Rock My World', 'Invincible', 2001, 'Em', 100, 'minor', 'funk', 0.80, 0.72, 0.92, 0.78, 'love,desire,joy', 'A cinematic video with Marlon Brando in his final film appearance.', 'Walking into a room and having the night get better immediately.'],
  ['Butterflies', 'Invincible', 2001, 'C', 90, 'major', 'ballad', 0.82, 0.40, 0.60, 0.92, 'love,compassion,devotion', 'Reached the R&B top forty without ever being a single.', 'The soft, endless middle of being in love.'],
  ['Speechless', 'Invincible', 2001, 'C', 70, 'major', 'ballad', 0.70, 0.30, 0.25, 0.95, 'awe,love,compassion,hope', 'A cappella opening, and a choir he built from his own voice.', 'Being so grateful it briefly stops the words.'],
  ['2000 Watts', 'Invincible', 2001, 'Cm', 118, 'minor', 'funk', -0.15, 0.90, 0.88, 0.30, 'intensity,tension,desire', 'A low, growling vocal he rarely used anywhere else.', 'Dialled all the way up with the knobs pulled off.'],
  ['Privacy', 'Invincible', 2001, 'Bm', 122, 'minor', 'funk-rock', -0.65, 0.85, 0.85, 0.20, 'anger,alienation,defiance', 'The last song on the album, and the angriest.', 'The rage of having no door left to close.'],
  ['Threatened', 'Invincible', 2001, 'Fm', 112, 'minor', 'funk-rock', -0.55, 0.85, 0.82, 0.25, 'fear,tension,paranoia', 'Rod Serling narrates, tying it back to Thriller.', 'Something circling that you cannot quite see yet.'],
  ['Whatever Happens', 'Invincible', 2001, 'Cm', 96, 'minor', 'ballad', -0.40, 0.60, 0.60, 0.70, 'tension,love,reflection', 'A Carlos Santana guitar line floats through the whole thing.', 'Holding on to something while bracing for the worst.'],
  ['The Lost Children', 'Invincible', 2001, 'D', 76, 'major', 'ballad', -0.30, 0.35, 0.30, 0.90, 'compassion,sadness,nostalgia', 'The most personal song on his last album of new material.', 'Looking out for the ones nobody else looked out for.'],
  ["Don't Walk Away", 'Invincible', 2001, 'C', 78, 'major', 'ballad', -0.60, 0.42, 0.45, 0.75, 'heartbreak,vulnerability,longing', 'A quiet plea that never became a single.', 'Asking someone to stay without any leverage left.'],
  ['You Are My Life', 'Invincible', 2001, 'D', 74, 'major', 'ballad', 0.88, 0.42, 0.50, 0.95, 'love,devotion,comfort', 'Written for his children.', 'The plainest, most certain kind of love there is.'],
  ['Cry', 'Invincible', 2001, 'C', 80, 'major', 'epoch', -0.35, 0.50, 0.40, 0.85, 'sorrow,compassion,hope', 'A gospel plea for the world, with a choir recorded in a single room.', 'Sorrow that still believes things could change.'],

  // --------------------------------------------------------------- posthumous
  ['Hold My Hand', 'Michael', 2010, 'C', 88, 'major', 'epoch', 0.78, 0.60, 0.72, 0.88, 'hope,unity,comfort', 'A duet with Akon, finished after his death.', 'Two people deciding to get through it together.'],
  ['Hollywood Tonight', 'Michael', 2010, 'Am', 116, 'minor', 'funk', -0.20, 0.75, 0.88, 0.45, 'escapism,alienation,longing', 'A song about a girl chasing a dream that is already eating her.', 'Chasing a city that has not decided to want you back.'],
  ['(I Like) The Way You Love Me', 'Michael', 2010, 'C', 112, 'major', 'ballad-motown', 0.85, 0.65, 0.82, 0.90, 'love,joy,devotion', 'Grew out of a voice memo he recorded at home.', 'The uncomplicated pleasure of being loved well.', 'the way you love me,i like the way you love me'],
  ['Behind the Mask', 'Michael', 2010, 'Em', 120, 'minor', 'disco', 0.80, 0.85, 0.93, 0.75, 'joy,celebration,unity', 'A Yellow Magic Orchestra song he demoed in 1982, finished decades later.', 'A crowd with its hands up and no reason to stop.'],
  ['The Toy', 'Michael', 2010, 'C', 84, 'major', 'ballad', 0.25, 0.40, 0.50, 0.85, 'nostalgia,vulnerability,hope', 'The original demo that became Best of Joy.', 'The child inside the song still holding the toy.'],
  ['Loving You', 'Xscape', 2014, 'C', 92, 'major', 'ballad', 0.78, 0.55, 0.72, 0.90, 'love,tenderness,longing', 'A Bad-era demo finished by Timbaland for Xscape.', 'A simple, happy love that keeps its own time.'],
  ['Love Never Felt So Good', 'Xscape', 2014, 'C', 118, 'major', 'disco', 0.85, 0.72, 0.90, 0.85, 'love,joy,nostalgia', 'A 1983 demo with Paul Anka, finished for Xscape.', 'Being delighted by a feeling you had written off.'],
  ['Love Never Felt So Good (with Justin Timberlake)', 'Xscape', 2014, 'C', 118, 'major', 'disco', 0.88, 0.76, 0.92, 0.85, 'love,joy,celebration', 'The duet version that put a posthumous single in the top ten.', 'The same delight, shared out loud with someone else.', 'love never felt so good with justin timberlake,classic mj x love never felt so good,love never felt so good justin timberlake', 'Justin Timberlake'],
  ['Chicago', 'Xscape', 2014, 'Bm', 108, 'minor', 'funk', -0.55, 0.72, 0.82, 0.35, 'heartbreak,betrayal,tension', 'A She Was Lovin\u2019 Me demo rebuilt with a colder edge.', 'Finding out the whole thing was never what you thought.'],
  ['A Place With No Name', 'Xscape', 2014, 'Am', 112, 'minor', 'funk', 0.55, 0.70, 0.88, 0.65, 'escapism,desire,hope', 'A reworking of America\u2019s A Horse with No Name.', 'An open road that asks no questions.'],
  ['Blue Gangsta', 'Xscape', 2014, 'Cm', 116, 'minor', 'funk', -0.60, 0.80, 0.85, 0.25, 'anger,betrayal,defiance', 'An Invincible-era demo about a man pushed past his limit.', 'The moment patience runs out and something else takes over.'],
  ['Xscape', 'Xscape', 2014, 'Bm', 108, 'minor', 'funk', -0.25, 0.85, 0.88, 0.35, 'escapism,tension,urgency', 'The title track, unfinished for over a decade.', 'Running from something, on purpose, at speed.'],
  ['Do You Know Where Your Children Are', 'Xscape', 2014, 'Am', 112, 'minor', 'funk-rock', -0.65, 0.72, 0.78, 0.55, 'compassion,grief,urgency', 'A song about children with nowhere safe to go.', 'Fear for someone small who cannot protect themselves.'],
  ['Slave to the Rhythm', 'Xscape', 2014, 'Em', 122, 'minor', 'funk', -0.35, 0.86, 0.90, 0.35, 'tension,defiance,urgency', 'A Dangerous-era demo that finally surfaced.', 'Locked into a beat you did not choose.'],
  ['One More Chance', 'Number Ones', 2003, 'A', 84, 'major', 'ballad', -0.25, 0.50, 0.60, 0.85, 'longing,heartbreak,love', 'The last original single released in his lifetime.', 'Asking one last time, and knowing the answer.'],
  ['This Is It', 'This Is It', 2009, 'C', 86, 'major', 'epoch', 0.62, 0.58, 0.60, 0.85, 'hope,resilience,reflection', 'Heard for the first time in the film that followed his death.', 'An almost-there promise, which is what makes it ache.'],
  ["We've Had Enough", 'The Ultimate Collection', 2004, 'Cm', 92, 'minor', 'funk-rock', -0.72, 0.80, 0.75, 0.35, 'anger,injustice,grief', 'A protest song about a killing that never made an album.', 'Grief that turned into a demand.'],
  ['Immortal Megamix', 'Immortal', 2011, 'Am', 126, 'minor', 'disco', 0.80, 0.92, 0.95, 0.60, 'celebration,joy,energy', 'The Cirque du Soleil show condensed into six minutes.', 'Every hit at once, with the tempo pushed up.'],
  ['What a Lovely Way to Go', 'Michael', 2010, 'Am', 92, 'minor', 'ballad', -0.30, 0.50, 0.55, 0.60, 'melancholy,weariness,reflection', 'A keyboard demo that surfaced posthumously.', 'A wry shrug at the end of something long.'],
  ['Who Do You Know', 'Michael', 2010, 'C', 90, 'major', 'ballad', -0.20, 0.45, 0.55, 0.70, 'reflection,longing,melancholy', 'An unfinished demo from the Invincible era.', 'Trying to place a face you should probably remember.'],
];

/* ---------------------------------------------------------------- building */

const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

const ALBUM_ART = {
  'Diana Ross Presents The Jackson 5': ['#c8892f', '#4a2c0f'],
  ABC: ['#d9a441', '#5b3410'],
  'Third Album': ['#caa15c', '#3d2510'],
  'Maybe Tomorrow': ['#b98b52', '#33200e'],
  Ben: ['#c2a06a', '#3a2a14'],
  'Got to Be There': ['#d0a24a', '#3a2a14'],
  'Forever, Michael': ['#b9986b', '#2f2314'],
  'Off the Wall': ['#e8d9b0', '#2b2118'],
  Thriller: ['#d21f2c', '#160406'],
  'Thriller 25': ['#ff4d5a', '#2a0508'],
  Bad: ['#e9e9ee', '#101014'],
  Dangerous: ['#e0b34a', '#241703'],
  HIStory: ['#8fa3b8', '#101720'],
  'Blood on the Dance Floor': ['#8b1a24', '#160305'],
  'Blood on the Dance Floor 2017': ['#b02330', '#1c0406'],
  'Blood on the Dance Floor x Dangerous': ['#c22b39', '#200507'],
  Ghosts: ['#6f7b8c', '#0d1218'],
  Invincible: ['#2ec5c0', '#0a2a33'],
  Michael: ['#7f8fd4', '#12162e'],
  Xscape: ['#c9a227', '#241b04'],
  'Number Ones': ['#d8d8e0', '#141418'],
  'This Is It': ['#e8b64a', '#2a1c06'],
  'The Ultimate Collection': ['#9aa0ac', '#14161c'],
  Immortal: ['#d2452f', '#2a0c06'],
  'USA for Africa': ['#7fb069', '#1b2a17']
};

const ERAS = [
  [1900, 1975, 'Motown'],
  [1976, 1981, 'Off the Wall'],
  [1982, 1986, 'Thriller'],
  [1987, 1990, 'Bad'],
  [1991, 1994, 'Dangerous'],
  [1995, 2000, 'HIStory'],
  [2001, 9999, 'Invincible']
];

function eraFor(year) {
  for (const [from, to, name] of ERAS) if (year >= from && year <= to) return name;
  return 'Invincible';
}

function slugify(title) {
  return title.toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const BALLADY = new Set(['ballad', 'ballad-motown', 'epoch']);

export const TRACKS = T.map((row, i) => {
  const [title, album, year, key, bpm, scale, groove, v, a, d, w, themes, note, feel, aliases, feat] = row;
  const era = eraFor(year);
  return {
    id: `mj-${String(i + 1).padStart(3, '0')}`,
    title,
    album,
    year,
    era,
    slug: slugify(title),
    key,
    bpm,
    scale,
    groove,
    mood: { valence: v, arousal: a, danceability: d, warmth: w },
    themes: String(themes).split(',').map((s) => s.trim()).filter(Boolean),
    note,
    feel,
    colors: ALBUM_ART[album] || ['#9aa0ac', '#14161c'],
    aliases: String(aliases || '').split(',').map((s) => s.trim()).filter(Boolean),
    feat: feat || '',
    duration: BALLADY.has(groove) ? 74 : 66
  };
});

/* --------------------------------------------------------------- matching */

/**
 * Release descriptors that live in parentheses but are not part of the song.
 * Only ever applied inside brackets, so a title containing the word "video"
 * could never be damaged.
 */
const NOISE_TOKENS = [
  'official 4k music video', 'official 4k video', 'official music video', 'official lyric video',
  'official visualizer', 'official video', 'official audio', 'official',
  'lyric video', 'music video', 'visualizer', 'video', 'audio',
  'shortened version', 'extended version', 'radio edit', 'single version', 'album version',
  'upscaled', 'remastered', 'remaster',
  'prison version', 'duet with akon',
  "mike's mix", 'mikes mix', 'mike s mix',
  'the white panda mash up', 'white panda mash up', 'mash up', 'mashup',
  'demo'
].sort((a, b) => b.length - a.length);

const NOISE_RE = new RegExp(
  NOISE_TOKENS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).join('|'),
  'gi'
);

/** Split "(a (b) c)" into groups, innermost-safe, so noise can be pruned. */
function pruneParentheticals(text) {
  // Work from the inside out so nested groups collapse correctly.
  let out = text;
  for (let pass = 0; pass < 4; pass++) {
    const next = out.replace(/\(([^()]*)\)/g, (whole, inner) => {
      // Hyphens inside brackets are tag punctuation ("Mash-Up", "Video - Upscaled"),
      // never part of a title, so they become spaces before matching.
      let cleaned = inner.replace(/-/g, ' ').replace(NOISE_RE, ' ');
      // "(with Justin Timberlake)" / "(feat. X)" are credits, not the song.
      cleaned = cleaned.replace(/^(?:with|feat|featuring|ft)\s+.*$/i, '');
      cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
      return cleaned ? `(${cleaned})` : ' ';
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

/** "Michael Jackson, Janet Jackson - Scream" -> { artist, title } */
export function splitArtist(raw) {
  const m = /^(.*?)\s+-\s+(.*)$/.exec(String(raw));
  if (!m || !/michael\s+jackson/i.test(m[1])) return { artist: '', title: String(raw) };
  return { artist: m[1], title: m[2] };
}

/** Normalise any title or filename fragment to a comparable key. */
export function normalizeTitle(input) {
  let s = String(input).replace(/\.[a-z0-9]{2,5}$/i, '');
  s = s.replace(/\s+ft\..*$/i, ' ').replace(/\s+featuring\s+.*$/i, ' ');
  s = pruneParentheticals(s);
  s = s.replace(/[\u29f8\u2044\u2215/]/g, ' ');
  s = s.replace(/[’'`´]/g, '');
  s = s.replace(/&/g, ' and ');
  s = s.replace(/[^A-Za-z0-9]+/g, ' ');
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Two indexes: a fully qualified key that includes the credited artists, and a
 * bare key with the artist stripped. Full keys win, so
 * "Michael Jackson, Justin Timberlake - Love Never Felt So Good" resolves to the
 * duet rather than the solo version.
 */
const { FULL_INDEX, BARE_INDEX } = (() => {
  const full = new Map();
  const bare = new Map();
  const add = (map, key, track) => {
    if (key && !map.has(key)) map.set(key, track);
  };
  for (const track of TRACKS) {
    const titles = [track.title, ...track.aliases];
    // Register the credit-qualified form too, so
    // "Michael Jackson, Justin Timberlake - X" beats the solo "Michael Jackson - X".
    const credits = track.feat
      ? ['Michael Jackson', `Michael Jackson ${track.feat}`, track.feat]
      : ['Michael Jackson'];
    for (const t of titles) {
      for (const credit of credits) add(full, normalizeTitle(`${credit} ${t}`), track);
      add(bare, normalizeTitle(t), track);
    }
  }
  return { FULL_INDEX: full, BARE_INDEX: bare };
})();

/** Resolve a filename to a track, preferring an artist-qualified match. */
export function matchFile(fileName) {
  const raw = String(fileName).replace(/\.[a-z0-9]{2,5}$/i, '');
  const { artist, title } = splitArtist(raw);
  const bare = normalizeTitle(title);
  if (artist) {
    const full = normalizeTitle(`${artist} ${title}`);
    const hit = FULL_INDEX.get(full);
    if (hit) return hit;
  }
  return BARE_INDEX.get(bare) || null;
}

export function findTrack(fileName) {
  return matchFile(fileName);
}

/** Which of several copies of the same song to actually use. */
function preferenceScore(fileName) {
  const n = String(fileName).toLowerCase();
  let score = 0;
  if (/official audio|\baudio\b/.test(n)) score += 100;
  else if (/official (4k )?video/.test(n)) score += 60;
  else score += 40;
  if (/shortened|upscaled|prison version|lyric video/.test(n)) score -= 25;
  if (/demo/.test(n)) score -= 40;
  if (/remix|mash|megamix|steve aoki/.test(n)) score -= 30;
  score -= n.length * 0.01;
  return score;
}

/**
 * Intersect the knowledge base with the files on disk.
 *
 * @param {Array<{name: string, url: string}>} files
 * @returns {{songs: object[], unmatched: string[], variants: object[]}}
 */
export function buildCatalog(files = []) {
  const byTrack = new Map();
  const unmatched = [];

  for (const file of files) {
    const track = matchFile(file.name);
    if (!track) { unmatched.push(file.name); continue; }
    const list = byTrack.get(track.id) || [];
    list.push(file);
    byTrack.set(track.id, list);
  }

  const songs = [];
  const variants = [];

  for (const track of TRACKS) {
    const matches = byTrack.get(track.id);
    if (!matches || !matches.length) continue;
    const ranked = [...matches].sort((a, b) => preferenceScore(b.name) - preferenceScore(a.name));
    const chosen = ranked[0];
    for (const extra of ranked.slice(1)) {
      variants.push({ title: track.title, file: extra.name, chosen: chosen.name });
    }
    songs.push({
      ...track,
      files: { audio: chosen.url, name: chosen.name, lrc: null }
    });
  }

  songs.sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));
  return { songs, unmatched, variants };
}

export const THEME_NAMES = [...new Set(TRACKS.flatMap((t) => t.themes))].sort();

export default { TRACKS, buildCatalog, matchFile, findTrack, normalizeTitle, splitArtist, THEME_NAMES };
