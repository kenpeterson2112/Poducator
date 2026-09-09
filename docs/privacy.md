# Poducator — Privacy Model

*This is the version to hand a school, a district privacy officer, or a parent.*

## The short version

**Poducator never learns any student's name.** The database has no column for one.

A teacher can still see which student answered what, because the teacher holds the only copy of
the mapping between a student's name and their pseudonym — on their own device, never on our
servers.

## How it works

When a teacher creates a lesson, Poducator generates a roster of opaque pseudonyms:

```
lynx-particle-42
cedar-vector-17
harbor-isotope-08
```

The teacher assigns these to students however they like — printed on slips, in their own
gradebook, written on the board. **That assignment is recorded only in the teacher's browser**
(IndexedDB), and can be exported as a CSV the teacher stores wherever their school policy requires.

A student opens the app, enters the class code and their pseudonym, and does the lesson. Every
answer is stored against `lynx-particle-42`. Not a name, not an email, not a student ID, not a
device fingerprint.

The teacher's dashboard shows results by pseudonym. Their browser locally substitutes the names
back in for display. If someone else opened that same dashboard on a different machine, they would
see pseudonyms and nothing else.

## What is stored

| Stored | Not stored |
|---|---|
| Pseudonym (`lynx-particle-42`) | Name |
| Lesson ID and class code | Email address |
| Which items were answered, and how | Student ID / SIS identifier |
| Whether each answer was correct | IP address (beyond transient request logs) |
| Time taken per item | Device or browser fingerprint |
| The lesson transcript the student heard | Location |
| Timestamps | Anything from outside the lesson |

## Who can read what

- **Students** cannot read anything. The app has no read path for student data; all student
  traffic goes through a server function that only writes.
- **Teachers** can read only data belonging to lessons they created. This is enforced by
  Postgres Row Level Security at the database level, not by application code that could be
  bypassed.
- **Nobody at Poducator** can connect a pseudonym to a person, because that connection has never
  been transmitted.

## Deliberate limitations

Stating these plainly, because a privacy document that only lists strengths isn't trustworthy:

- **A pseudonym is only as anonymous as its handling.** A teacher who emails the roster CSV
  around, or projects it on a screen, has undone the protection. The protection is
  architectural, not magical.
- **Small classes leak.** In a class of six, a pattern of answers can identify someone to anyone
  who knows the students. This is inherent to small-group analytics, not specific to Poducator.
- **Lesson content goes to Anthropic's API.** Source material and generated dialogue are sent to
  Claude to produce the podcast. Student *answers* are not sent to the model as identifiable
  records, but checkpoint responses do influence subsequent generation within a session.
- **The teacher's device becomes sensitive.** By design, the name mapping lives there. A lost,
  shared, or unlocked teacher laptop is the realistic weak point in this model, and schools should
  treat the exported CSV as they would a gradebook.

## If a student needs their data deleted

Because there is no name in the system, deletion is done by pseudonym. A teacher looks up the
pseudonym in their local roster and deletes those sessions from the dashboard. Since the mapping
is local, this is the only route — which is a consequence of the design working as intended.

## Compliance posture

Poducator is a prototype and has not been assessed against FERPA, COPPA, or state student-privacy
statutes. The architecture is intended to make that assessment straightforward — collecting no
personally identifiable information is the strongest position to start from — but *intended to
be compliant* is not *assessed as compliant*, and this should not be deployed with real students
until a school's own review has happened.
