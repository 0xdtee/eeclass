import sys, fitz
f=sys.argv[1]
d=fitz.open(f)
t=''
for p in d[:2]:
    t+=p.get_text()
print(t[:900])
