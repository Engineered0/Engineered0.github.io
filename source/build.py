import re,sys
local='--local' in sys.argv
import os
d=os.path.dirname(os.path.abspath(__file__))+'/'
model=open(d+'model.js').read()
model=model[model.index('/*MODEL-BEGIN*/'):model.index('/*MODEL-END*/')+len('/*MODEL-END*/')]
three='<script src="three.min.js"></script>' if local else '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>'
html=f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vision Bench: machine vision setup trainer</title>
<meta name="description" content="Choose lighting, lenses and cameras for real inspection jobs and see whether the defect shows up.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@500;600&display=swap" rel="stylesheet">
<style>
{open(d+'style.css').read()}
</style>
</head>
<body>
{open(d+'body.html').read()}
{three}
<script>
"use strict";
{model}
{open(d+'sensor.js').read()}
{open(d+'scene.js').read()}
{open(d+'app.js').read()}
</script>
</body>
</html>
'''
out=d+('test.html' if local else 'vision-bench.html')
open(out,'w').write(html)
print(out,len(html))
