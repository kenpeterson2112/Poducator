/**
 * items.js — the pre-built assessment bank (spec §9, §11).
 *
 * 54 items: nine expectations x three matched pre/post pairs. Nothing here is
 * generated at runtime, and that is the point.
 *
 * WHY A FIXED BANK
 *
 * Spec §11 flagged a real conflict of interest: Claude authored the assessment
 * AND taught the content, so the model could teach to its own test. A fixed,
 * human-reviewable bank removes the conflict entirely. It also deletes the one
 * blocking API call that stood between a student pressing start and seeing a
 * question, which is the latency the student actually feels.
 *
 * HOW THESE ARE BUILT
 *
 * Every item follows five rules, drawn from NRC assessment standards, NGSS
 * three-dimensional task design, and Ontario's Growing Success:
 *
 *   1. PHENOMENON FIRST. Each stem opens on a concrete situation, not a
 *      definition. Students reason about a thing that happened.
 *
 *   2. EVERY CHOICE IS CLAIM + REASON. A two-tier item (claim, then reasoning)
 *      is the standard way to catch a student who is right for the wrong
 *      reason — but a second tier would cost a question we do not have. Folding
 *      the because-clause into each choice buys most of that diagnostic power
 *      for free.
 *
 *   3. EVERY DISTRACTOR IS A NAMED MISCONCEPTION. `misconception` is a slug into
 *      MISCONCEPTIONS below, which is what lets a teacher dashboard report
 *      "7 students think symmetry is decorative" instead of "7 missed D2.4".
 *      The wrong answer is the payload; a throwaway distractor wastes the item.
 *      Teacher-facing only — the student sees the explanation, never the label.
 *
 *   4. PAIRS MATCH ON COGNITIVE DEMAND. A pre/post pair shares `category`,
 *      `practice` and `crosscutting`, and differs only in phenomenon. Matching
 *      difficulty alone is not enough: if the post item sits at a lower demand
 *      than the pre item, the growth delta measures a change in the instrument
 *      rather than a change in the student.
 *
 *   5. FAIRNESS BY CONTEXT REVIEW. No stem assumes a house, a car, a bike, a
 *      backyard, travel, or any hobby. Every scenario is one a Grade 7 in
 *      Ontario has stood in front of — usually at school. Reading load is kept
 *      low on purpose; a wordy stem assesses reading, not science.
 *
 * ORDERING WITHIN EACH ARRAY IS LOAD-BEARING. Items run
 * [thinking, application, knowledge], and the sampler takes the first N. A
 * lesson covering three expectations therefore asks one thinking-level item
 * about each — the most informative single question — rather than three recall
 * items. A lesson covering one expectation asks all three and spans all three
 * Growing Success categories assessable in this format.
 *
 * WHAT THIS INSTRUMENT CANNOT DO. Growing Success asks for triangulation across
 * observations, conversations and products. This is one leg: products. It also
 * cannot assess Communication, which needs constructed response or talk. Three
 * items is a placement signal, not a measurement — see the caveat carried on
 * the result screen.
 */

/**
 * Growing Success achievement categories reachable through multiple choice.
 * Communication is deliberately absent: it needs a constructed response.
 */
export const CATEGORY = Object.freeze({
  KNOWLEDGE: 'knowledge',      // Knowledge & Understanding
  THINKING: 'thinking',        // Thinking & Investigation
  APPLICATION: 'application',  // Application
});

/** Teacher-facing labels for the categories. */
export const CATEGORY_LABEL = Object.freeze({
  [CATEGORY.KNOWLEDGE]: 'Knowledge & Understanding',
  [CATEGORY.THINKING]: 'Thinking & Investigation',
  [CATEGORY.APPLICATION]: 'Application',
});

/**
 * Misconception library. Slug → what the student who picked it actually
 * believes, written for a teacher deciding what to do tomorrow morning.
 *
 * These are the reason the bank exists in this shape. A percentage tells a
 * teacher nothing they can teach to; "most of the class thinks total weight is
 * what makes a structure stable" tells them exactly what to put on the board.
 */
export const MISCONCEPTIONS = Object.freeze({
  // D1.1 — weighing design factors
  'upfront-cost-only': 'Treats the price to build as the whole economic picture, ignoring lifetime running cost.',
  'price-equals-quality': 'Assumes a more expensive option is automatically better built.',
  'factors-are-independent': 'Sees environmental, social and economic factors as separate and not comparable, so no trade-off is possible.',
  'bigger-is-better': 'Assumes a larger structure serves a community better regardless of need.',
  'any-impact-means-dont-build': 'Concludes that any environmental impact rules out building, rather than weighing and reducing it.',
  'social-factor-only': 'Treats public preference as the only factor that counts.',
  'confuses-economic-for-environmental': 'Labels a cost consideration as an environmental one.',
  'confuses-social-for-environmental': 'Labels a community consideration as an environmental one.',
  'confuses-scheduling-for-environmental': 'Treats a project timeline as an environmental factor.',
  'confuses-environmental-for-social': 'Labels an energy or resource consideration as a social one.',
  'confuses-economic-for-social': 'Labels a cost consideration as a social one.',
  'confuses-scheduling-for-social': 'Treats a project timeline as a social factor.',

  // D1.2 — ergonomics
  'load-weight-only': 'Believes only how much a load weighs matters, not how it is carried or positioned.',
  'reject-the-tool': 'Concludes the object should not be used at all, rather than that its design or use should change.',
  'blame-the-user': 'Places the problem in the person rather than the design — the central ergonomics misconception. Ergonomics fits the task to the person, not the reverse.',
  'posture-not-design': 'Believes the user changing their behaviour substitutes for changing the design.',
  'taller-is-better': 'Treats a single "better" dimension as the fix rather than adjustability.',
  'lower-is-always-better': 'Treats one fixed height as universally comfortable.',
  'wait-for-user-to-change': 'Assumes the user will grow or adapt into a poor fit rather than the design accommodating them now.',
  'ergonomics-is-styling': 'Believes ergonomic design is about appearance.',
  'ergonomics-is-cost': 'Believes ergonomic design is about cheaper manufacturing.',
  'ergonomics-is-performance': 'Believes ergonomic design means the tool performs its function better, rather than fitting its user.',
  'lighter-is-always-better': 'Treats minimum weight as the goal of ergonomic design.',

  // D2.1 — classifying structures
  'hard-means-solid': 'Classifies by how the material feels rather than by how the structure carries load.',
  'strong-means-solid': 'Equates strength with the solid classification.',
  'rigid-means-frame': 'Assumes anything that holds a fixed shape is a frame structure.',
  'material-determines-type': 'Classifies by what the structure is made of rather than how it carries load.',
  'weight-determines-type': 'Classifies by how heavy the structure is.',
  'size-determines-type': 'Classifies by how large the structure is.',
  'outline-means-shell': 'Assumes anything that outlines or surrounds a space is a shell structure.',
  'sections-mean-frame': 'Assumes a structure built in parts must be a frame structure.',
  'containment-means-shell': 'Assumes anything that holds something back is a shell structure.',
  'structures-are-buildings-only': 'Believes only buildings count as structures.',
  'structures-must-be-stationary': 'Believes something that moves or floats is not a structure.',
  'categories-are-meaningless': 'Believes the three categories overlap so completely that classification carries no information.',

  // D2.2 — centre of gravity
  'weight-anywhere-equals-stability': 'Believes adding weight anywhere increases stability, regardless of where it sits.',
  'total-mass-determines-stability': 'Believes total weight determines stability rather than how that weight is distributed. The most common misconception in this expectation.',
  'relationship-inverted': 'Has the relationship backwards — believes a HIGHER centre of gravity makes a structure harder to tip.',
  'narrow-base-helps': 'Believes a smaller base is easier to balance, inverting the wide-base rule.',
  'irrelevant-change': 'Selects a change that cannot affect stability, suggesting no working model of what causes tipping.',
  'geometric-centre-always': 'Believes the centre of gravity is always the geometric middle, regardless of how mass is arranged.',
  'heaviest-part-is-cg': 'Believes the centre of gravity is located at the heaviest single component.',
  'base-is-cg': 'Believes the centre of gravity is where the structure meets the ground.',
  'heavy-means-low-cg': 'Believes heavy materials automatically produce a low centre of gravity.',
  'short-means-low-cg': 'Believes a low centre of gravity just means the structure is short.',
  'even-spread-means-low-cg': 'Believes evenly distributed weight is the same as a low centre of gravity.',

  // D2.3 — forces
  'magnitude-confused': 'Confuses another property of a force with its magnitude.',
  'direction-confused': 'Confuses another property of a force with its direction.',
  'point-confused': 'Confuses another property of a force with its point of application.',
  'duration-confused': 'Treats how long a force lasts as one of its defining properties. Duration is not one of the four.',
  'magnitude-changes-with-position': 'Believes moving where a force is applied changes how big the force is.',
  'direction-changes-with-position': 'Believes moving where a force is applied changes its direction.',
  'structure-explains-it': 'Reaches for a property of the object to explain an effect caused by point of application.',
  'magnitude-is-enough': 'Believes stating how big a force is fully describes it.',
  'point-is-enough': 'Believes stating where a force acts fully describes it.',

  // D2.4 — symmetry
  'symmetry-is-decorative': 'Believes symmetry in structures is about appearance and has no effect on how forces travel. The key misconception in this expectation.',
  'symmetry-saves-material': 'Believes symmetry is primarily a way to use less material.',
  'symmetry-guarantees-strength': 'Overclaims — believes a symmetrical structure cannot fail.',
  'symmetry-guarantees-stability': 'Believes symmetry alone makes a structure impossible to tip.',
  'asymmetry-means-failure': 'Believes an asymmetrical structure will always fail.',
  'symmetry-is-a-rule': 'Believes symmetry is a requirement every structure must satisfy.',
  'uniform-means-symmetric': 'Confuses uniform dimensions with mirror symmetry.',
  'material-means-symmetric': 'Confuses being made of one material with being symmetrical.',
  'repetition-means-symmetry': 'Confuses a repeating pattern with mirror symmetry.',
  'tapering-means-symmetry': 'Confuses a gradual change in shape with mirror symmetry.',
  'randomness-confused': 'Does not distinguish an ordered arrangement from a random one.',

  // D2.5 — failure
  'blames-material-category': 'Blames a whole class of material rather than the load, the conditions, or the design.',
  'failure-implies-original-defect': 'Believes a structure that later fails must have been built wrong, ignoring changing loads and material fatigue.',
  'failure-is-uncaused': 'Believes structures fail randomly with age and that failure has no identifiable cause.',
  'strongest-part-should-fail': 'Expects the largest component to fail first, missing that joints and foundations are common failure points.',
  'heavier-is-safer': 'Believes adding weight makes a structure safer.',
  'failure-cannot-be-diagnosed': 'Believes a collapse destroys the evidence, so causes cannot be determined.',
  'age-alone-causes-failure': 'Treats age by itself as a cause of failure.',
  'mixed-materials-cause-failure': 'Believes combining materials causes failure.',
  'unusual-shape-causes-failure': 'Believes an unfamiliar shape is inherently unsafe.',
  'fatigue-is-weight-gain': 'Believes metal fatigue means the metal gets heavier.',
  'fatigue-is-temperature': 'Believes metal fatigue is a temperature effect.',
  'fatigue-is-defect': 'Believes metal fatigue means the metal was poor quality when made.',

  // D2.6 — materials
  'strongest-is-best': 'Believes the strongest material is always the right choice. The dominant misconception in this expectation — suitability is a match to the job, not a ranking.',
  'material-choice-doesnt-matter': 'Believes materials perform interchangeably, so only price matters.',
  'heavy-equals-stable': 'Applies the stability rule from D2.2 to material selection, where it does not belong.',
  'cost-is-always-first': 'Believes lowest cost is always the deciding property.',
  'hardest-is-best': 'Believes maximum hardness is always desirable.',
  'lightest-is-best': 'Believes minimum weight is always desirable.',
  'appearance-first': 'Believes appearance outranks functional properties.',
  'newest-is-best': 'Believes newer materials are automatically more suitable.',
  'common-is-best': 'Believes the most commonly used material is the most suitable one.',
  'strength-is-only-property': 'Believes strength is the only property that determines suitability.',
  'corrosion-is-cosmetic': 'Believes rust affects only appearance, not structural integrity.',

  // D2.7 — assessing and maintaining safety
  'maintenance-is-replacement': 'Believes maintenance means replacing on a schedule rather than inspecting and repairing.',
  'safety-work-is-theatre': 'Believes inspection is a legal formality that finds nothing useful.',
  'appearance-carries-no-information': 'Overcorrects — believes visible condition tells you nothing at all.',
  'rating-is-arbitrary': 'Believes load ratings are guesses rather than calculated limits.',
  'over-engineering-improves-performance': 'Believes extra strength improves speed or handling rather than providing a safety margin.',
  'strength-replaces-maintenance': 'Believes a strong enough structure never needs inspection.',
  'testing-is-cosmetic': 'Believes pre-build testing is about appearance.',
  'testing-is-red-tape': 'Believes modelling and testing are procedural requirements rather than problem-finding.',
  'model-guarantees-success': 'Believes a successful model proves the full-scale structure cannot fail.',
  'damage-found-only-after-failure': 'Believes damage can only be found once something breaks.',
  'age-alone-indicates-damage': 'Believes a structure\'s age alone is enough to judge its condition.',
});

/** Shorthand for a correct choice — no misconception attached. */
const ok = (text) => ({ text, misconception: null });
/** Shorthand for a distractor carrying a named misconception. */
const no = (text, misconception) => ({ text, misconception });

/**
 * The bank, keyed by expectation code.
 *
 * Each expectation has `diagnostic` and `final` arrays of three items, index-
 * aligned into pairs: diagnostic[0] pairs with final[0], and so on. The sampler
 * takes the first N from each, so pairing survives any selection size.
 */
export const BANK = Object.freeze({
  /* ================================================================== */
  /* D1.1 — environmental, social and economic factors                   */
  /* ================================================================== */
  'D1.1': {
    diagnostic: [
      {
        category: CATEGORY.THINKING,
        practice: 'evaluate competing solutions',
        crosscutting: 'systems',
        prompt:
          'A town can build a community centre two ways. Design A is cheaper to build but ' +
          'expensive to heat. Design B costs more to build but very little to heat. What should ' +
          'the town weigh?',
        choices: [
          no('Design A, because the lower price to build is what a budget means.', 'upfront-cost-only'),
          ok("Design B, because what a building costs includes running it for years, not just building it."),
          no('Design B, because a higher price always means better construction.', 'price-equals-quality'),
          no("Either one, because cost and energy use are separate things that can't be compared.", 'factors-are-independent'),
        ],
        correctIndex: 1,
        explanation:
          'A building costs money every year it stands, not just the year it goes up. Heating is ' +
          'part of the price, so the cheaper build can end up being the more expensive choice.',
      },
      {
        category: CATEGORY.APPLICATION,
        practice: 'evaluate a design solution',
        crosscutting: 'systems',
        prompt:
          'A neighbourhood wants a new footbridge over a creek that a lot of wildlife uses. Which ' +
          'plan best balances the different factors?',
        choices: [
          no('Build the widest bridge possible, because a bigger structure serves more people.', 'bigger-is-better'),
          ok('Build during the season when wildlife is least affected, and use a design that needs little upkeep.'),
          no('Skip the bridge entirely, because any construction near a creek causes harm.', 'any-impact-means-dont-build'),
          no('Build whichever design the most people vote for, because community opinion is the only factor that counts.', 'social-factor-only'),
        ],
        correctIndex: 1,
        explanation:
          'Balancing means reducing the harm rather than pretending there is none or giving up on ' +
          'the need. Timing the work and designing for low maintenance does both.',
      },
      {
        category: CATEGORY.KNOWLEDGE,
        practice: 'construct an explanation',
        crosscutting: 'systems',
        prompt:
          'A designer says a new school "considered environmental factors." Which choice is an ' +
          'environmental factor?',
        choices: [
          ok("Using materials that can be recycled at the end of the building's life."),
          no('Making sure the building costs less than the budget allows.', 'confuses-economic-for-environmental'),
          no('Choosing a design that students and families find welcoming.', 'confuses-social-for-environmental'),
          no('Finishing construction before the school year starts.', 'confuses-scheduling-for-environmental'),
        ],
        correctIndex: 0,
        explanation:
          'Environmental factors are about effects on the natural world — resources used, waste ' +
          'produced, energy consumed. Cost is economic and community feeling is social.',
      },
    ],
    final: [
      {
        category: CATEGORY.THINKING,
        practice: 'evaluate competing solutions',
        crosscutting: 'systems',
        prompt:
          'A school board is choosing between two roof designs for a new gym. Roof A is cheaper to ' +
          'install but must be replaced in 15 years. Roof B costs more now and lasts 40 years. ' +
          'How should the board decide?',
        choices: [
          no('Roof A, because spending less today leaves more money for other things.', 'upfront-cost-only'),
          no('Roof B, because a more expensive roof is built to a higher standard.', 'price-equals-quality'),
          ok("Roof B, because cost over the roof's whole life matters more than the price on day one."),
          no('It cannot be decided, because installation cost and lifespan measure different things.', 'factors-are-independent'),
        ],
        correctIndex: 2,
        explanation:
          'Replacing Roof A twice over 40 years is part of what Roof A costs. Comparing lifetime ' +
          'cost is what makes the two designs comparable at all.',
      },
      {
        category: CATEGORY.APPLICATION,
        practice: 'evaluate a design solution',
        crosscutting: 'systems',
        prompt:
          'A city is adding a bus shelter on a busy street next to a small park. Which plan best ' +
          'balances the different factors?',
        choices: [
          no('Put in the largest shelter available, because a bigger shelter helps more riders.', 'bigger-is-better'),
          no('Cancel the shelter, because building anything next to a park damages it.', 'any-impact-means-dont-build'),
          no('Build whatever nearby residents prefer, because their opinion is the only factor that matters.', 'social-factor-only'),
          ok("Size it to the number of riders, place it clear of the park's trees, and pick materials that are easy to repair."),
        ],
        correctIndex: 3,
        explanation:
          'Each part of that answer handles a different factor — need, environment, and long-term ' +
          'cost — instead of letting one of them decide everything.',
      },
      {
        category: CATEGORY.KNOWLEDGE,
        practice: 'construct an explanation',
        crosscutting: 'systems',
        prompt: 'A report on a new arena lists several design decisions. Which one is a SOCIAL factor?',
        choices: [
          no('Choosing a roof that sheds snow so less energy is spent clearing it.', 'confuses-environmental-for-social'),
          ok('Adding ramps and wide doorways so everyone in the community can get in.'),
          no('Buying steel from the supplier with the lowest price.', 'confuses-economic-for-social'),
          no('Ordering materials early so the build stays on schedule.', 'confuses-scheduling-for-social'),
        ],
        correctIndex: 1,
        explanation:
          'Social factors are about how a structure serves the people who use it. Who can get in ' +
          'the door is exactly that question.',
      },
    ],
  },

  /* ================================================================== */
  /* D1.2 — ergonomic design                                             */
  /* ================================================================== */
  'D1.2': {
    diagnostic: [
      {
        category: CATEGORY.THINKING,
        practice: 'construct an explanation',
        crosscutting: 'cause and effect',
        prompt:
          'A student carries a heavy bag on one shoulder every day, and their back starts to ache. ' +
          'What is the ergonomic problem?',
        choices: [
          no('The bag is too heavy, because how a load is carried makes no difference.', 'load-weight-only'),
          ok('The load sits on one side, because weight carried unevenly strains the body more than the same weight spread out.'),
          no('Bags like that should not be used, because no bag is safe for carrying books.', 'reject-the-tool'),
          no('Their back is not strong enough yet, because students need to build up to heavier loads.', 'blame-the-user'),
        ],
        correctIndex: 1,
        explanation:
          'The same weight on two shoulders is far easier on a body than on one. Ergonomics looks ' +
          'at how a load meets the person, not just how much it weighs.',
      },
      {
        category: CATEGORY.APPLICATION,
        practice: 'define a problem',
        crosscutting: 'structure and function',
        prompt:
          "A classroom has one desk height for every student, and some students' feet do not reach " +
          'the floor. What is the best ergonomic fix?',
        choices: [
          no('Tell those students to sit up straighter, because good posture solves the problem.', 'posture-not-design'),
          ok('Provide adjustable chairs or footrests, because the furniture should fit the person using it.'),
          no('Replace all the desks with taller ones, because taller furniture is better quality.', 'taller-is-better'),
          no('Nothing needs fixing, because students will grow into the desks.', 'wait-for-user-to-change'),
        ],
        correctIndex: 1,
        explanation:
          'One fixed height cannot fit a room full of different bodies. Making the furniture ' +
          'adjustable is what fits the space to the people in it.',
      },
      {
        category: CATEGORY.KNOWLEDGE,
        practice: 'construct an explanation',
        crosscutting: 'structure and function',
        prompt: 'What is the main goal of ergonomic design?',
        choices: [
          ok('To fit tools and spaces to the people using them, so they can work safely and comfortably.'),
          no('To make tools and spaces look modern and appealing.', 'ergonomics-is-styling'),
          no('To make tools as light as possible, because lighter is always easier.', 'lighter-is-always-better'),
          no('To train people to use tools correctly, because most injuries come from mistakes.', 'blame-the-user'),
        ],
        correctIndex: 0,
        explanation:
          'Ergonomics fits the task to the person. When something hurts to use, the design is what ' +
          'should change first.',
      },
    ],
    final: [
      {
        category: CATEGORY.THINKING,
        practice: 'construct an explanation',
        crosscutting: 'cause and effect',
        prompt:
          'A student uses a laptop on their lap for hours and their neck starts to hurt. What is ' +
          'the ergonomic problem?',
        choices: [
          no('They need to strengthen their neck, because looking down is something people get used to.', 'blame-the-user'),
          no('Laptops should not be used for schoolwork, because no laptop is safe to work on.', 'reject-the-tool'),
          ok('The screen sits far below eye level, because holding the head bent forward strains the neck over time.'),
          no('The laptop is too heavy, because where a screen sits makes no difference.', 'load-weight-only'),
        ],
        correctIndex: 2,
        explanation:
          'A head held forward for hours puts steady strain on the neck. Raising the screen changes ' +
          'the design rather than asking the body to cope.',
      },
      {
        category: CATEGORY.APPLICATION,
        practice: 'define a problem',
        crosscutting: 'structure and function',
        prompt:
          'A school library has one counter height, and shorter students have to reach up to use ' +
          'it. What is the best ergonomic fix?',
        choices: [
          no('Lower every counter, because lower is always more comfortable.', 'lower-is-always-better'),
          no('Ask shorter students to stand on their toes, because it only takes a moment.', 'posture-not-design'),
          no('Leave it as it is, because students will be tall enough in a few years.', 'wait-for-user-to-change'),
          ok('Add a section at a lower height, because a space used by different people needs to fit all of them.'),
        ],
        correctIndex: 3,
        explanation:
          'Lowering everything just moves the problem to taller users. A space shared by different ' +
          'bodies needs more than one option.',
      },
      {
        category: CATEGORY.KNOWLEDGE,
        practice: 'construct an explanation',
        crosscutting: 'structure and function',
        prompt:
          'A tool company says a new pair of scissors is "ergonomically designed." What does that ' +
          'most likely mean?',
        choices: [
          no('The scissors are cheaper to make than older models.', 'ergonomics-is-cost'),
          ok('The handles are shaped to fit a hand, so they are comfortable and safe to use for a long time.'),
          no('The scissors come in more colours and styles than before.', 'ergonomics-is-styling'),
          no('The scissors are sharper than any other pair on the market.', 'ergonomics-is-performance'),
        ],
        correctIndex: 1,
        explanation:
          'Ergonomic means shaped around the user. Sharpness is about how well the tool cuts; ' +
          'ergonomics is about what using it does to the hand holding it.',
      },
    ],
  },

  /* ================================================================== */
  /* D2.1 — solid, frame, shell                                          */
  /* ================================================================== */
  'D2.1': {
    diagnostic: [
      {
        category: CATEGORY.THINKING,
        practice: 'use a model to classify',
        crosscutting: 'structure and function',
        prompt:
          'A hard hat is hollow inside. A thin, curved outer layer spreads out the force of ' +
          'anything that hits it. How is it classified?',
        choices: [
          no('A solid structure, because it feels hard and stiff.', 'hard-means-solid'),
          no('A frame structure, because it has to hold its shape.', 'rigid-means-frame'),
          ok('A shell structure, because a thin outer layer carries the load and encloses a space.'),
          no('Not a structure at all, because it is something a person wears.', 'structures-are-buildings-only'),
        ],
        correctIndex: 2,
        explanation:
          'The classification comes from how the load travels. In a hard hat the thin curved ' +
          'surface does the work, which is what makes it a shell.',
      },
      {
        category: CATEGORY.APPLICATION,
        practice: 'use a model to classify',
        crosscutting: 'structure and function',
        prompt:
          'A bike rack is made of metal bars joined together, with open space between them. How is ' +
          'it classified, and why?',
        choices: [
          no('A shell structure, because the bars form an outer edge around a space.', 'outline-means-shell'),
          no('A solid structure, because metal is dense and heavy.', 'material-determines-type'),
          ok('A frame structure, because connected parts carry the load and the spaces between them carry nothing.'),
          no('It is all three, because every structure fits every category.', 'categories-are-meaningless'),
        ],
        correctIndex: 2,
        explanation:
          'In a frame, the bars carry everything and the gaps carry nothing. That is a different ' +
          'job from a shell, where the surface itself is what holds.',
      },
      {
        category: CATEGORY.KNOWLEDGE,
        practice: 'construct an explanation',
        crosscutting: 'structure and function',
        prompt: 'What decides whether a structure is solid, frame, or shell?',
        choices: [
          ok('How the structure carries its load.'),
          no('What material the structure is made from.', 'material-determines-type'),
          no('How heavy the structure is.', 'weight-determines-type'),
          no('How large the structure is.', 'size-determines-type'),
        ],
        correctIndex: 0,
        explanation:
          'Steel appears in all three types and so does concrete. The category describes the path ' +
          'the load takes, not what the thing is made of.',
      },
    ],
    final: [
      {
        category: CATEGORY.THINKING,
        practice: 'use a model to classify',
        crosscutting: 'structure and function',
        prompt:
          'A canoe is hollow, and its thin curved sides carry the load of the water pressing ' +
          'against them. How is it classified?',
        choices: [
          no('A frame structure, because it is long and has to stay rigid.', 'rigid-means-frame'),
          ok('A shell structure, because a thin outer layer carries the load and encloses a space.'),
          no('A solid structure, because it has to be strong enough not to break.', 'strong-means-solid'),
          no('Not a structure at all, because it floats instead of standing still.', 'structures-must-be-stationary'),
        ],
        correctIndex: 1,
        explanation:
          'The curved skin of the canoe is what carries the water pressure. A thin surface doing ' +
          'the load-carrying is the definition of a shell.',
      },
      {
        category: CATEGORY.APPLICATION,
        practice: 'use a model to classify',
        crosscutting: 'structure and function',
        prompt:
          'A construction crane is built from steel beams bolted into a tall open lattice. How is ' +
          'it classified, and why?',
        choices: [
          ok('A frame structure, because joined parts carry the load and the open spaces carry nothing.'),
          no('A solid structure, because steel is one of the heaviest materials used in building.', 'material-determines-type'),
          no('A shell structure, because the beams form an outline around the air inside.', 'outline-means-shell'),
          no('None of the three, because a crane moves instead of staying in one place.', 'structures-must-be-stationary'),
        ],
        correctIndex: 0,
        explanation:
          'The beams and their connections carry everything; the open space is just air. An ' +
          'outline around a space is not the same as a surface that holds.',
      },
      {
        category: CATEGORY.KNOWLEDGE,
        practice: 'construct an explanation',
        crosscutting: 'structure and function',
        prompt:
          'A concrete dam holds back a lake using its own great mass. Which type is it, and what ' +
          'makes that the deciding factor?',
        choices: [
          no('A frame structure, because dams are built in sections.', 'sections-mean-frame'),
          no('A shell structure, because it holds back the water on one side.', 'containment-means-shell'),
          ok('A solid structure, because its own mass is what resists the load.'),
          no('It depends on the material, because concrete can be used in any type.', 'material-determines-type'),
        ],
        correctIndex: 2,
        explanation:
          'A gravity dam works by being heavy enough that the water cannot push it. When mass ' +
          'itself does the job, the structure is solid.',
      },
    ],
  },

  /* ================================================================== */
  /* D2.2 — centre of gravity and stability                              */
  /* ================================================================== */
  'D2.2': {
    diagnostic: [
      {
        category: CATEGORY.THINKING,
        practice: 'analyze and interpret',
        crosscutting: 'stability and change',
        prompt:
          'Two identical bookshelves hold the same books. One has the heavy books on the top ' +
          'shelf, the other on the bottom shelf. Which is more stable?',
        choices: [
          no('The one with heavy books on top, because the weight presses the shelf down.', 'weight-anywhere-equals-stability'),
          ok('The one with heavy books on the bottom, because it lowers the centre of gravity.'),
          no('They are equally stable, because both hold the same total weight.', 'total-mass-determines-stability'),
          no('The one with heavy books on top, because a higher centre of gravity is harder to tip.', 'relationship-inverted'),
        ],
        correctIndex: 1,
        explanation:
          'Both shelves weigh the same, so weight is not what separates them. Where that weight ' +
          'sits is — low weight is harder to tip over.',
      },
      {
        category: CATEGORY.APPLICATION,
        practice: 'evaluate a design solution',
        crosscutting: 'stability and change',
        prompt:
          'A tall display sign keeps blowing over in the wind. Without making it shorter, what ' +
          'would help most?',
        choices: [
          ok('Add weight to the base, because that lowers the centre of gravity.'),
          no('Add weight to the top, because heavier structures do not move.', 'total-mass-determines-stability'),
          no('Make the base narrower, because a smaller base is easier to balance.', 'narrow-base-helps'),
          no('Paint it a darker colour, because that changes how it stands.', 'irrelevant-change'),
        ],
        correctIndex: 0,
        explanation:
          'Weight low down pulls the centre of gravity toward the ground, and a low centre of ' +
          'gravity over a wide base is what resists tipping.',
      },
      {
        category: CATEGORY.KNOWLEDGE,
        practice: 'construct an explanation',
        crosscutting: 'stability and change',
        prompt: 'Where is the centre of gravity of a structure?',
        choices: [
          ok("The point where the structure's weight acts as if it were all concentrated."),
          no('The exact middle of the structure, no matter how the weight is arranged.', 'geometric-centre-always'),
          no('The heaviest single part of the structure.', 'heaviest-part-is-cg'),
          no('The point where the structure touches the ground.', 'base-is-cg'),
        ],
        correctIndex: 0,
        explanation:
          'It is a balance point, not a physical part. Move the weight around inside a structure ' +
          'and the centre of gravity moves with it.',
      },
    ],
    final: [
      {
        category: CATEGORY.THINKING,
        practice: 'analyze and interpret',
        crosscutting: 'stability and change',
        prompt:
          'Two identical delivery vans carry the same load. One has the load stacked high, the ' +
          'other has it spread across the floor. Which is harder to tip on a turn?',
        choices: [
          no('They tip the same, because the total weight is identical.', 'total-mass-determines-stability'),
          no('The one stacked high, because a tall load presses down harder.', 'weight-anywhere-equals-stability'),
          ok('The one spread across the floor, because it keeps the centre of gravity low.'),
          no('The one stacked high, because raising the centre of gravity adds stability.', 'relationship-inverted'),
        ],
        correctIndex: 2,
        explanation:
          'Same van, same load, different answer — which tells you the arrangement is doing the ' +
          'work. Weight kept low is weight that resists tipping.',
      },
      {
        category: CATEGORY.APPLICATION,
        practice: 'evaluate a design solution',
        crosscutting: 'stability and change',
        prompt:
          'A camping lantern on a pole keeps falling over on uneven ground. Without shortening the ' +
          'pole, what would help most?',
        choices: [
          ok('Use a wider, heavier foot, because a low centre of gravity over a wide base resists tipping.'),
          no('Put the heaviest part at the top, because weight up high steadies a pole.', 'relationship-inverted'),
          no('Make the foot smaller, because a narrow base is easier to balance.', 'narrow-base-helps'),
          no('Use a brighter bulb, because that changes how it stands.', 'irrelevant-change'),
        ],
        correctIndex: 0,
        explanation:
          'Two things make something hard to tip: weight kept low, and a wide base under it. A ' +
          'heavy wide foot does both at once.',
      },
      {
        category: CATEGORY.KNOWLEDGE,
        practice: 'construct an explanation',
        crosscutting: 'stability and change',
        prompt: 'A structure is described as having "a low centre of gravity." What does that tell you?',
        choices: [
          no('It is made of heavy materials.', 'heavy-means-low-cg'),
          ok('Most of its weight sits near its base, so it resists tipping.'),
          no('It is shorter than other structures of its kind.', 'short-means-low-cg'),
          no('Its weight is spread perfectly evenly through it.', 'even-spread-means-low-cg'),
        ],
        correctIndex: 1,
        explanation:
          'A low centre of gravity is about where the weight sits, not how much there is or how ' +
          'tall the structure stands. A tall structure can have one.',
      },
    ],
  },

  /* ================================================================== */
  /* D2.3 — forces on structures                                         */
  /* ================================================================== */
  'D2.3': {
    diagnostic: [
      {
        category: CATEGORY.THINKING,
        practice: 'use a model of forces',
        crosscutting: 'cause and effect',
        prompt: 'You push a door open. Which detail describes the POINT OF APPLICATION of your force?',
        choices: [
          no('How hard you push, because that is the size of the force.', 'magnitude-confused'),
          no('Which way you push, because that is where the force goes.', 'direction-confused'),
          ok('Where on the door your hand touches it.'),
          no('How long you keep pushing, because a longer push is a bigger force.', 'duration-confused'),
        ],
        correctIndex: 2,
        explanation:
          'Point of application is simply the spot the force acts on. How hard is magnitude, and ' +
          'which way is direction — three different things about the same push.',
      },
      {
        category: CATEGORY.APPLICATION,
        practice: 'construct an explanation',
        crosscutting: 'cause and effect',
        prompt:
          'A door opens easily when you push near the handle but barely moves when you push just ' +
          'as hard near the hinge. Why?',
        choices: [
          no('The force is bigger at the handle, because the door is wider there.', 'magnitude-changes-with-position'),
          ok('The same force has a different effect depending on where it is applied.'),
          no('The direction of the force changes as you move along the door.', 'direction-changes-with-position'),
          no('Doors are built weaker near the handle, because that is where they are used.', 'structure-explains-it'),
        ],
        correctIndex: 1,
        explanation:
          'You pushed exactly as hard in both places, so the force was the same size. Only where ' +
          'it landed changed — which is why point of application is worth naming.',
      },
      {
        category: CATEGORY.KNOWLEDGE,
        practice: 'construct an explanation',
        crosscutting: 'cause and effect',
        prompt:
          'A force on a structure is described as having a magnitude of 200 newtons. What does ' +
          'that tell you?',
        choices: [
          ok('How strong the force is.'),
          no('Which direction the force acts in.', 'direction-confused'),
          no('Where on the structure the force is applied.', 'point-confused'),
          no('How long the force lasts.', 'duration-confused'),
        ],
        correctIndex: 0,
        explanation:
          'Magnitude is the size of a force and nothing else. Newtons measure how strong, not ' +
          'which way, where, or for how long.',
      },
    ],
    final: [
      {
        category: CATEGORY.THINKING,
        practice: 'use a model of forces',
        crosscutting: 'cause and effect',
        prompt:
          'A worker pulls on a rope tied to a post. Which detail describes the DIRECTION of the force?',
        choices: [
          no('How many newtons of pull the rope carries.', 'magnitude-confused'),
          no('The spot on the post where the rope is tied.', 'point-confused'),
          ok('Which way the rope runs as the worker pulls.'),
          no('How many seconds the worker keeps pulling.', 'duration-confused'),
        ],
        correctIndex: 2,
        explanation:
          'Direction is which way the force acts. The rope shows it: the pull follows the line the ' +
          'rope runs along.',
      },
      {
        category: CATEGORY.APPLICATION,
        practice: 'construct an explanation',
        crosscutting: 'cause and effect',
        prompt:
          'A wrench turns a stiff bolt when you grip the far end, but not when you grip close to ' +
          'the bolt, even pushing just as hard. Why?',
        choices: [
          no('Gripping further out makes your push stronger.', 'magnitude-changes-with-position'),
          no('The wrench is thinner at the far end, so it bends more easily.', 'structure-explains-it'),
          ok('The same force turns the bolt more when it is applied further from it.'),
          no('The direction of your push changes as you slide your hand along.', 'direction-changes-with-position'),
        ],
        correctIndex: 2,
        explanation:
          'Your push is identical in both grips. Moving it further from the bolt changes what that ' +
          'same force can do — the same reason a door handle sits far from the hinge.',
      },
      {
        category: CATEGORY.KNOWLEDGE,
        practice: 'construct an explanation',
        crosscutting: 'cause and effect',
        prompt: 'To describe a force on a structure completely, what do you need to state?',
        choices: [
          no('Only how big the force is, because size is what matters.', 'magnitude-is-enough'),
          ok('How big it is, which way it acts, where it acts, and the plane it acts in.'),
          no('How big it is and how long it lasts.', 'duration-confused'),
          no('Only where it is applied, because that decides the effect.', 'point-is-enough'),
        ],
        correctIndex: 1,
        explanation:
          'Four properties: magnitude, direction, point of application, and plane of application. ' +
          'Leave one out and two very different forces can look identical on paper.',
      },
    ],
  },

  /* ================================================================== */
  /* D2.4 — symmetry in structures                                       */
  /* ================================================================== */
  'D2.4': {
    diagnostic: [
      {
        category: CATEGORY.THINKING,
        practice: 'construct an explanation',
        crosscutting: 'patterns',
        prompt: 'Why do many bridges and towers use a symmetrical design?',
        choices: [
          no('Symmetrical structures look better, but it makes no difference to how they work.', 'symmetry-is-decorative'),
          ok('Symmetry helps spread forces evenly through the structure.'),
          no('Symmetrical structures use less material than any other shape.', 'symmetry-saves-material'),
          no('Symmetry makes a structure impossible to knock down.', 'symmetry-guarantees-strength'),
        ],
        correctIndex: 1,
        explanation:
          'When both halves match, the loads on each side balance and forces travel down in ways ' +
          'engineers can predict. That is a working reason, not a visual one.',
      },
      {
        category: CATEGORY.APPLICATION,
        practice: 'argue from evidence',
        crosscutting: 'patterns',
        prompt:
          'A balcony sticks out from one side of a building and is not symmetrical. Is the design ' +
          'necessarily unsafe?',
        choices: [
          no('Yes, because a structure that is not symmetrical will always fail.', 'asymmetry-means-failure'),
          ok('No, because a design can be sound when it is built to handle the uneven load on it.'),
          no('Yes, because symmetry is a rule that every structure has to follow.', 'symmetry-is-a-rule'),
          no('No, because symmetry has nothing to do with how structures carry force.', 'symmetry-is-decorative'),
        ],
        correctIndex: 1,
        explanation:
          'Symmetry makes loads easier to balance, but it is not a requirement. An uneven structure ' +
          'is fine when the design accounts for the uneven forces on it.',
      },
      {
        category: CATEGORY.KNOWLEDGE,
        practice: 'use a model',
        crosscutting: 'patterns',
        prompt: 'A structure has a line of symmetry. What does that mean?',
        choices: [
          ok('One side is a mirror image of the other.'),
          no('The structure is the same size all the way up.', 'uniform-means-symmetric'),
          no('The structure is perfectly balanced and cannot tip.', 'symmetry-guarantees-stability'),
          no('The structure is made of only one material.', 'material-means-symmetric'),
        ],
        correctIndex: 0,
        explanation:
          'A line of symmetry splits a shape into two halves that mirror each other. It says ' +
          'nothing on its own about material or whether the structure can tip.',
      },
    ],
    final: [
      {
        category: CATEGORY.THINKING,
        practice: 'construct an explanation',
        crosscutting: 'patterns',
        prompt:
          'A transmission tower is built the same on both sides of its centre line. What does that ' +
          'symmetry do for it?',
        choices: [
          no('It makes the tower cheaper than an uneven design would be.', 'symmetry-saves-material'),
          no('It means the tower cannot fail, no matter the conditions.', 'symmetry-guarantees-strength'),
          ok('It balances the loads on each side, so forces travel down predictably.'),
          no('It is only about appearance, since towers are not meant to be attractive.', 'symmetry-is-decorative'),
        ],
        correctIndex: 2,
        explanation:
          'Matching halves means matching loads, and matching loads are loads an engineer can ' +
          'calculate. Predictable is the benefit — not indestructible.',
      },
      {
        category: CATEGORY.APPLICATION,
        practice: 'argue from evidence',
        crosscutting: 'patterns',
        prompt:
          'A ski jump ramp is much steeper on one side than the other. Does that asymmetry mean it ' +
          'is badly designed?',
        choices: [
          no('No, because symmetry does not affect how forces move through a structure.', 'symmetry-is-decorative'),
          no('Yes, because every safe structure must be symmetrical.', 'symmetry-is-a-rule'),
          ok('No, because the shape matches the uneven job the ramp has to do.'),
          no('Yes, because an uneven structure always collapses eventually.', 'asymmetry-means-failure'),
        ],
        correctIndex: 2,
        explanation:
          'The ramp does an uneven job, so an uneven shape is the right answer to it. Form follows ' +
          'the forces the structure actually meets.',
      },
      {
        category: CATEGORY.KNOWLEDGE,
        practice: 'use a model',
        crosscutting: 'patterns',
        prompt: 'Which structure shows symmetry?',
        choices: [
          no('A staircase where each step is higher than the one before.', 'repetition-means-symmetry'),
          no('A pile of rocks of many different sizes.', 'randomness-confused'),
          ok('A truss bridge whose left half mirrors its right half.'),
          no('A tower that gets narrower toward the top.', 'tapering-means-symmetry'),
        ],
        correctIndex: 2,
        explanation:
          'Symmetry means one half mirrors the other. A repeating pattern or a gradual taper is ' +
          'orderly, but it is not the same thing.',
      },
    ],
  },

  /* ================================================================== */
  /* D2.5 — why structures fail                                          */
  /* ================================================================== */
  'D2.5': {
    diagnostic: [
      {
        category: CATEGORY.THINKING,
        practice: 'construct an explanation from evidence',
        crosscutting: 'stability and change',
        prompt:
          'Classroom shelves held textbooks for years with no problem. A teacher adds three boxes ' +
          'of equipment to the top shelf, and a month later a bracket snaps. What best explains ' +
          'the failure?',
        choices: [
          ok('The load grew past what the shelves were built to carry, because a structure is safe only up to a certain load.'),
          no('Shelves are weak, because brackets always give out eventually.', 'blames-material-category'),
          no('They must have been built wrong from the start, because a properly built structure never fails.', 'failure-implies-original-defect'),
          no('Nothing in particular caused it, because structures just fail randomly once they get old.', 'failure-is-uncaused'),
        ],
        correctIndex: 0,
        explanation:
          'Every structure has a limit it was designed for. The shelves did not change — what was ' +
          'asked of them did.',
      },
      {
        category: CATEGORY.APPLICATION,
        practice: 'analyze and interpret evidence',
        crosscutting: 'cause and effect',
        prompt:
          'An engineer inspects a collapsed carport and finds the posts intact but the bolts ' +
          'joining them to the roof sheared off. What does this point to?',
        choices: [
          no('The posts were the wrong material, because they should have broken first.', 'strongest-part-should-fail'),
          ok('The connections failed, because a structure is only as strong as the joints between its parts.'),
          no('The roof was too light, because heavier roofs stay put.', 'heavier-is-safer'),
          no('Nothing can be concluded, because a collapse destroys the evidence.', 'failure-cannot-be-diagnosed'),
        ],
        correctIndex: 1,
        explanation:
          'The parts were fine and the joins were not, which is exactly what the wreckage shows. ' +
          'Connections are one of the most common places a structure gives way.',
      },
      {
        category: CATEGORY.KNOWLEDGE,
        practice: 'construct an explanation',
        crosscutting: 'cause and effect',
        prompt: 'Which of these is a factor that can cause a structure to fail?',
        choices: [
          ok('A load heavier than the structure was designed to carry.'),
          no('A structure being older than ten years.', 'age-alone-causes-failure'),
          no('A structure being made of more than one material.', 'mixed-materials-cause-failure'),
          no('A structure having an unusual shape.', 'unusual-shape-causes-failure'),
        ],
        correctIndex: 0,
        explanation:
          'Overloading is a real cause. Age, mixed materials and unusual shapes are all common in ' +
          'structures that stand for a century.',
      },
    ],
    final: [
      {
        category: CATEGORY.THINKING,
        practice: 'construct an explanation from evidence',
        crosscutting: 'stability and change',
        prompt:
          'A wooden footbridge in a park carried walkers safely for twenty years. After a winter ' +
          'of heavy snow and road salt, a support gives way. What best explains the failure?',
        choices: [
          no('Wood should never be used outdoors, because it always rots through.', 'blames-material-category'),
          no('The bridge was defective when it was built, because a good structure lasts forever.', 'failure-implies-original-defect'),
          ok('Weather weakened the support over time until it could no longer carry the load.'),
          no('There is no explanation, because old structures fail without a reason.', 'failure-is-uncaused'),
        ],
        correctIndex: 2,
        explanation:
          'Materials change in service. Twenty good years does not mean the bridge was flawless, ' +
          'and one bad winter does not mean it was doomed from the start.',
      },
      {
        category: CATEGORY.APPLICATION,
        practice: 'analyze and interpret evidence',
        crosscutting: 'cause and effect',
        prompt:
          'After a shed collapses, an inspector finds the walls and roof undamaged but one corner ' +
          'of the foundation sunk into soft ground. What does this point to?',
        choices: [
          no('The shed was too heavy, because lighter sheds do not sink.', 'heavier-is-safer'),
          no('The walls must have been weak, because they should have held the shed up.', 'strongest-part-should-fail'),
          no('Nothing can be determined after a collapse, because everything shifts.', 'failure-cannot-be-diagnosed'),
          ok('The foundation failed, because a structure is only as stable as what it rests on.'),
        ],
        correctIndex: 3,
        explanation:
          'Undamaged walls above a sunken corner tell the story. What a structure stands on is part ' +
          'of the structure.',
      },
      {
        category: CATEGORY.KNOWLEDGE,
        practice: 'construct an explanation',
        crosscutting: 'cause and effect',
        prompt: 'Metal fatigue is one cause of structural failure. What is it?',
        choices: [
          no('Metal becoming heavier as it takes on more load.', 'fatigue-is-weight-gain'),
          ok('Metal weakening after being loaded and unloaded many times.'),
          no('Metal becoming too cold to hold its shape.', 'fatigue-is-temperature'),
          no('Metal being of low quality when it was made.', 'fatigue-is-defect'),
        ],
        correctIndex: 1,
        explanation:
          'Repeated loading and unloading builds up tiny cracks. Good metal can still fatigue, ' +
          'which is why inspection matters even on a well-built structure.',
      },
    ],
  },

  /* ================================================================== */
  /* D2.6 — choosing materials                                           */
  /* ================================================================== */
  'D2.6': {
    diagnostic: [
      {
        category: CATEGORY.THINKING,
        practice: 'evaluate a design solution',
        crosscutting: 'structure and function',
        prompt:
          'A school is replacing its playground slide. The old one got dangerously hot in summer ' +
          'and had a rough patch that scratched students. Which material choice best fits the job?',
        choices: [
          no('Whatever is strongest, because a playground structure should never break.', 'strongest-is-best'),
          ok('Smooth and slow to heat up, because the material has to suit how the slide is actually used.'),
          no('The cheapest option, because all materials perform about the same outdoors.', 'material-choice-doesnt-matter'),
          no('The heaviest option, because weight will keep the slide from tipping.', 'heavy-equals-stable'),
        ],
        correctIndex: 1,
        explanation:
          'Both problems with the old slide were about the surface, not about strength. The right ' +
          'material is the one that matches the job.',
      },
      {
        category: CATEGORY.APPLICATION,
        practice: 'define a problem',
        crosscutting: 'structure and function',
        prompt: 'An engineer needs material for an airplane part. Which property is likely to matter MOST?',
        choices: [
          ok('A high strength for its weight, because the part must be strong without adding much mass.'),
          no('The lowest possible price, because saving money is always the priority.', 'cost-is-always-first'),
          no('The greatest possible hardness, because harder materials are better.', 'hardest-is-best'),
          no('The most attractive appearance, because passengers see the plane.', 'appearance-first'),
        ],
        correctIndex: 0,
        explanation:
          'Every kilogram on a plane has to be lifted. Strength alone is not enough — it is ' +
          'strength for the weight that decides.',
      },
      {
        category: CATEGORY.KNOWLEDGE,
        practice: 'construct an explanation',
        crosscutting: 'structure and function',
        prompt: 'What makes a material "suitable" for a particular structure?',
        choices: [
          ok('Its properties match what the structure needs to do.'),
          no('It is the strongest material available.', 'strongest-is-best'),
          no('It is the newest material available.', 'newest-is-best'),
          no('It is the material used most often in construction.', 'common-is-best'),
        ],
        correctIndex: 0,
        explanation:
          'Suitability is a match, not a ranking. The best material for a slide is a poor one for ' +
          'a bridge cable, and neither is "better".',
      },
    ],
    final: [
      {
        category: CATEGORY.THINKING,
        practice: 'evaluate a design solution',
        crosscutting: 'structure and function',
        prompt:
          'A school is choosing material for outdoor lunch tables that sit in sun and rain ' +
          'year-round. Which choice best fits the job?',
        choices: [
          no('The heaviest material available, because heavy tables will not blow over.', 'heavy-equals-stable'),
          no('The strongest material available, because strength is what makes a table good.', 'strongest-is-best'),
          ok('Something weather-resistant and easy to clean, because the material has to suit where the table lives.'),
          no('Whatever costs least, because any material works the same outdoors.', 'material-choice-doesnt-matter'),
        ],
        correctIndex: 2,
        explanation:
          'A table strong enough to hold lunches is easy. Surviving a few years of weather is the ' +
          'actual problem, so that is what the material has to solve.',
      },
      {
        category: CATEGORY.APPLICATION,
        practice: 'define a problem',
        crosscutting: 'structure and function',
        prompt: 'An engineer needs material for a fire door in a school. Which property is likely to matter MOST?',
        choices: [
          no('The lightest possible weight, because doors should be easy to open.', 'lightest-is-best'),
          no('The lowest cost, because schools should always spend as little as possible.', 'cost-is-always-first'),
          no('The most attractive finish, because the door is seen every day.', 'appearance-first'),
          ok("Resistance to heat, because the door's job is to hold back fire."),
        ],
        correctIndex: 3,
        explanation:
          'Start from what the thing is for. A fire door that is light, cheap and handsome but ' +
          'burns through has failed at the only job it had.',
      },
      {
        category: CATEGORY.KNOWLEDGE,
        practice: 'construct an explanation',
        crosscutting: 'structure and function',
        prompt:
          'Two materials are both strong enough for a bridge railing, but one rusts outdoors and ' +
          'one does not. What does this show about choosing materials?',
        choices: [
          no('Strength is the only property that matters, so either would work.', 'strength-is-only-property'),
          ok('Durability in the actual conditions matters alongside strength.'),
          no('The more expensive one is automatically the better choice.', 'price-equals-quality'),
          no('Rust does not affect a structure, only its appearance.', 'corrosion-is-cosmetic'),
        ],
        correctIndex: 1,
        explanation:
          'Strong enough on day one is not the same as strong enough in year twenty. Rust removes ' +
          'metal, and metal that is gone carries nothing.',
      },
    ],
  },

  /* ================================================================== */
  /* D2.7 — assessing and maintaining safety                             */
  /* ================================================================== */
  'D2.7': {
    diagnostic: [
      {
        category: CATEGORY.THINKING,
        practice: 'construct an explanation',
        crosscutting: 'stability and change',
        prompt: 'Why do engineers inspect a bridge regularly even when nothing appears wrong with it?',
        choices: [
          ok('Because problems like small cracks and rust build up slowly and are easier to fix early.'),
          no('Because bridges get rebuilt on a fixed schedule no matter what.', 'maintenance-is-replacement'),
          no('Because inspections are legally required, not because they find anything useful.', 'safety-work-is-theatre'),
          no('Because a bridge that looks fine is just as likely to fail as one that looks damaged.', 'appearance-carries-no-information'),
        ],
        correctIndex: 0,
        explanation:
          'Damage starts small and grows. Finding a crack early is cheap and safe; finding it late ' +
          'is neither.',
      },
      {
        category: CATEGORY.APPLICATION,
        practice: 'use a model',
        crosscutting: 'systems',
        prompt:
          'An elevator is rated to carry 1000 kg, but its cables are built to hold far more than ' +
          'that. Why do engineers design it this way?',
        choices: [
          no('Because the rating is a guess and the real limit is unknown.', 'rating-is-arbitrary'),
          ok('Because a factor of safety leaves room for wear, overloading, and the unexpected.'),
          no('Because stronger cables make the elevator move faster.', 'over-engineering-improves-performance'),
          no('Because the extra strength means the elevator will never need inspection.', 'strength-replaces-maintenance'),
        ],
        correctIndex: 1,
        explanation:
          'The extra capacity is deliberate margin. Cables wear, people overload, and something ' +
          'unexpected eventually happens — the margin is what absorbs it.',
      },
      {
        category: CATEGORY.KNOWLEDGE,
        practice: 'construct an explanation',
        crosscutting: 'systems',
        prompt:
          'Before a large structure is built, engineers often test a scale model or run a computer ' +
          'simulation. Why?',
        choices: [
          ok('To find problems while they are still cheap and safe to fix.'),
          no('To decide what colour the finished structure should be.', 'testing-is-cosmetic'),
          no('Because building a model is required before any construction.', 'testing-is-red-tape'),
          no('Because a model that stands proves the real structure cannot fail.', 'model-guarantees-success'),
        ],
        correctIndex: 0,
        explanation:
          'A problem found on a model costs a redraw. The same problem found after building costs ' +
          'far more, and can cost someone their safety.',
      },
    ],
    final: [
      {
        category: CATEGORY.THINKING,
        practice: 'construct an explanation',
        crosscutting: 'stability and change',
        prompt:
          'A school has its roof structure checked every year even though there has never been a ' +
          'problem. Why?',
        choices: [
          no('Because roofs are replaced on a set schedule regardless of condition.', 'maintenance-is-replacement'),
          ok('Because slow changes like sagging or corrosion are cheapest and safest to catch early.'),
          no('Because the check is a formality that never finds anything.', 'safety-work-is-theatre'),
          no('Because how a roof looks tells you nothing about its condition.', 'appearance-carries-no-information'),
        ],
        correctIndex: 1,
        explanation:
          '"Never had a problem" is the result of the checking, not a reason to stop. Slow changes ' +
          'are exactly what a yearly look is for.',
      },
      {
        category: CATEGORY.APPLICATION,
        practice: 'use a model',
        crosscutting: 'systems',
        prompt:
          'A rope rated to hold 500 kg is used on a scaffold where workers and tools total 150 kg. ' +
          'Why is the rope rated so far above the actual load?',
        choices: [
          no('Because the rope will never be inspected once it is in place.', 'strength-replaces-maintenance'),
          no('Because a heavier rating makes the scaffold easier to move.', 'over-engineering-improves-performance'),
          ok('Because the safety margin covers wear, shock loads, and mistakes.'),
          no('Because ratings are rough estimates that cannot be trusted.', 'rating-is-arbitrary'),
        ],
        correctIndex: 2,
        explanation:
          'A rope that is only just strong enough has nothing left for a sudden jolt or a frayed ' +
          'spot. The margin is planned, not wasted.',
      },
      {
        category: CATEGORY.KNOWLEDGE,
        practice: 'construct an explanation',
        crosscutting: 'systems',
        prompt:
          'What is one way engineers check a structure for damage WITHOUT taking it apart or ' +
          'harming it?',
        choices: [
          no('They wait until a part breaks and then examine it.', 'damage-found-only-after-failure'),
          ok('They use methods like ultrasound or X-ray to look inside a part.'),
          no('They replace every part on a fixed schedule instead of checking.', 'maintenance-is-replacement'),
          no("They estimate the damage from the structure's age alone.", 'age-alone-indicates-damage'),
        ],
        correctIndex: 1,
        explanation:
          'These are called non-destructive tests: they find cracks inside a part while leaving ' +
          'the part in service.',
      },
    ],
  },
});

/** Every expectation code the bank covers. */
export const BANKED_CODES = Object.freeze(Object.keys(BANK));

/** Teacher-facing description of a misconception slug. */
export function describeMisconception(slug) {
  return MISCONCEPTIONS[slug] ?? slug;
}
