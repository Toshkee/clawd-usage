# clawd-usage

Mod za Claude Code: iznad prompta crta mjerače potrošnje (kontekst sesije, 5h i 7d limit, cijena) i Clawda sa ultracode štapićem, koji između zamaha izvodi trikove iz banera.

## Instalacija

```bash
git clone https://github.com/Toshkee/clawd-usage ~/.claude/skills/clawd-usage
```

Zatim ponovo pokreni Claude Code. Mod se učitava u svakoj sesiji, u bilo kom folderu. Nova verzija: `git pull` u tom folderu.

## Korišćenje

- `/clawd` sakriva i ponovo prikazuje traku.
- Traka se crta u terminalu i u desktop aplikaciji.
- Poslije 5 minuta bez aktivnosti Clawd miruje dok sesija opet ne proradi.

## Napomene

- Pravljen i testiran na Claude Code 2.1.287; API za modove se još mijenja između izdanja.
- Redovi `5h` i `7d` traže prijavu preko Claude pretplate. Mod jednom u minuti čita potrošnju tvog naloga sa istog mjesta kao `/usage`; uz API ključ ostaju samo kontekst i cijena.
- Testovi: `claude plugin test .`
