#!/bin/bash
PERSON=${1:-"Rick Moy"}
npx tsx scripts/test_person_search.ts "$PERSON"
