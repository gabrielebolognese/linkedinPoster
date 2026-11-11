# fixture spec for the build runner self-test

<!-- global:start -->
## Global rules

G1. Every file is plain text with LF line endings.
G2. Commit your work and leave a clean working tree.
<!-- global:end -->

# Batches

<!-- batch:M01:start -->
## M01. Hello file

<!-- needs: A -->

**Build.** Create `hello.txt` as described in appendix A.

```acceptance
# timeout-minutes: 1
test -f hello.txt
grep -q hello hello.txt
```
<!-- batch:M01:end -->

<!-- batch:M02:start -->
## M02. World file

**Build.** Create `world.txt` containing the word world.

NEXT: Read hello.txt and world.txt.

```acceptance
# a comment line
test -f world.txt
grep -q world world.txt
```
<!-- batch:M02:end -->

# Appendices

<!-- appendix:A:start -->
## Appendix A. File contents

#### File: `hello.txt`

~~~~
hello
~~~~

A tilde block may hold backticks, which must not confuse the parser:

~~~~
```acceptance
exit 1
```
~~~~
<!-- appendix:A:end -->
