require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const port = 3000;

// Serve static files (HTML, CSS, JS) from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));
// Assume this is part of your login function on the frontend
// After successful login
//localStorage.setItem('companyName', 'Edgeverve');

// Middleware
app.use(bodyParser.json());
app.use(cors());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// const session = require('express-session');
const MongoStore = require('connect-mongo');



// MongoDB connection URL and Database name
const url = 'mongodb://localhost:27017';
const dbName = 'Miniproject';

// MongoDB Client
let db;

MongoClient.connect(url, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(client => {
    console.log('Connected to Database');
    db = client.db(dbName);
    console.log('Email user:', process.env.EMAIL_USER);
    console.log('Email pass:', process.env.EMAIL_PASS);
  })
  .catch(error => {
    console.error('Error connecting to MongoDB:', error);
    process.exit(1); // Exit the process if unable to connect
  });

// Configure Nodemailer
const transporter = nodemailer.createTransport({
  service: 'Gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Function to send email notification
const sendEmailNotification = (to, subject, text) => {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to,
    subject,
    text
  };

  return transporter.sendMail(mailOptions);
};

// Check and create 'uploads' directory if it doesn't exist
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname)); // Append the file extension
  }
});

const upload = multer({ storage });

// Root endpoint
app.get('/', (req, res) => {
  res.send('Welcome to the Job Applications API');
});

// Endpoint to handle job applications
app.post('/apply', upload.single('resume'), async (req, res) => {
  try {
    const { companyId, companyName, role, fullName, phoneNumber, email, username } = req.body;
    const resumePath = req.file.path; // Get the path to the uploaded file

    const newApplication = {
      usn: username,
      companyId,
      companyName,
      role,
      fullName,
      phoneNumber,
      email,
      resume: resumePath
    };

    await db.collection('ApplyJob').insertOne(newApplication);
    res.status(201).send('Application submitted successfully');
  } catch (error) {
    console.error('Error submitting application:', error);
    res.status(500).send('Error submitting application');
  }
});

// Endpoint to fetch job applications
app.get('/api/applications/:usn', (req, res) => {
  const usn = req.params.usn;
  console.log(`Fetching job applications for user: ${usn}`);

  db.collection('ApplyJob').find({ usn: usn }).toArray()
    .then(applications => {
      console.log('Applications fetched successfully:', applications);
      res.status(200).json(applications);
    })
    .catch(error => {
      console.error('Error fetching job applications:', error);
      res.status(500).json({ message: 'Internal server error' });
    });
});
//endpoint login request
app.post('/api/login', async (req, res) => {
  const { username, password, userType } = req.body;

  if (!username || !password || !userType) {
    return res.status(400).json({ message: 'Username, password, and userType are required' });
  }

  try {
    const collection = db.collection('login');
    const user = await collection.findOne({ username, password, userType });

    if (user) {
      if (userType === "Company") {
        const companyDetails = await db.collection('addcompany').findOne({ companyName: username });
        res.status(200).json({ message: 'Login successful', companyName: companyDetails.companyName });
      } else {
        res.status(200).json({ message: 'Login successful' });
      }
    } else {
      res.status(401).json({ message: 'Invalid username or password' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});



// Routes for adding and viewing company details
app.post('/submit_company', async (req, res) => {
  const companyDetails = req.body;

  try {
    // Insert company details into 'addcompany' collection
    await db.collection('addcompany').insertOne(companyDetails);

    // Create login credentials for the company
    const loginCredentials = { username: companyDetails.companyName, password: companyDetails.companyName, userType: "Company" };
    await db.collection('login').insertOne(loginCredentials);

    // Notify all students about the new company
    const students = await db.collection('Student_details').find().toArray();
    const notifications = [];
    const notificationDetails = [];

    for (const student of students) {
      const subject = 'New Company Added';
      const text = `Dear ${student.fullname},\n\nA new company has been added to the placement portal.\n\nCompany Name: ${companyDetails.companyName}\nRole: ${companyDetails.role}\nLocation: ${companyDetails.location}\n\nBest regards,\nPlacement Office`;

      try {
        // Send email notification to each student
        await sendEmailNotification(student.email, subject, text);

        // Log notification details in 'notifications' collection
        const notification = await db.collection('notifications').insertOne({
          studentId: student._id,
          studentName: student.fullname,
          companyId: companyDetails.companyId,
          companyName: companyDetails.companyName,
          sentDate: new Date()
        });

        notificationDetails.push({
          studentName: student.fullname,
          studentEmail: student.email
        });

      } catch (error) {
        console.error('Error sending email:', error);
      }
    }

    // Return success response with notification details
    res.status(200).json({
      message: 'Company details added successfully',
      companyDetails,
      notificationDetails
    });
  } catch (error) {
    console.error('Error adding company details:', error);
    res.status(500).send('Error adding company details');
  }
});

app.get('/view_company', (req, res) => {
  db.collection('addcompany').find().toArray()
    .then(results => {
      res.status(200).json(results);
    })
    .catch(error => {
      res.status(500).send('Error fetching company details');
    });
});

// Endpoint to fetch all student applications
app.get('/api/applications/student', async (req, res) => {
  try {
      const applications = await db.collection('ApplyJob').find().toArray();
      res.status(200).json(applications);
  } catch (error) {
      console.error('Error fetching applications:', error);
      res.status(500).json({ message: 'Error fetching applications' });
  }
});


// Endpoint for adding placement officer details
app.post('/add_placement_officer', (req, res) => {
  const officerDetails = req.body;
  officerDetails.userType='placementofficer'

  if (!officerDetails.username || !officerDetails.password) {
    return res.status(400).json({ success: false, message: 'Username and password are required' });
  }

  db.collection('login').insertOne(officerDetails)
    .then(result => {
      res.status(200).json({ success: true, message: 'Placement officer added successfully' });
    })
    .catch(error => {
      console.error('Error adding placement officer details:', error);
      res.status(500).json({ success: false, message: 'Error adding placement officer details' });
    });
});

// Endpoint to update profile
// Endpoint to fetch student profile based on username
app.get('/api/profile/:username', async (req, res) => {
  const username = req.params.username;

  try {
    const profile = await db.collection('Student_details').findOne({ usn: username });

    if (profile) {
      res.status(200).json(profile);
    } else {
      res.status(404).json({ message: 'Profile not found' });
    }
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ message: 'Error fetching profile' });
  }
});

// Endpoint to add student details
app.post('/api/add_student', (req, res) => {
  const studentDetails = req.body;
  console.log('Received student details:', studentDetails); // Log received data

  // Add student details to Student_details collection
  db.collection('Student_details').insertOne(studentDetails)
    .then(result => {
      console.log('Student details added successfully');

      // Store USN as username and password in login collection
      const loginCredentials = { username: studentDetails.usn, password: studentDetails.usn, userType: "Student" };

      db.collection('login').insertOne(loginCredentials)
        .then(loginResult => {
          console.log('Login credentials added successfully');
          res.status(200).json({ message: 'Student details and login credentials added successfully' });
        })
        .catch(loginError => {
          console.error('Error adding login credentials:', loginError);
          res.status(500).json({ message: 'Error adding login credentials' });
        });
    })
    .catch(error => {
      console.error('Error adding student details:', error);
      res.status(500).json({ message: 'Error adding student details' });
    });
});

// Endpoint to create profile
app.post('/api/createprofile', (req, res) => {
  const profileData = req.body;

  db.collection('profiles').insertOne(profileData)
    .then(result => {
      res.json({ success: true, message: 'Profile created successfully' });
    })
    .catch(error => {
      console.error('Error creating profile:', error);
      res.json({ success: false, message: 'Error creating profile' });
    });
});



// Endpoint to fetch all notifications
app.get('/api/notifications/all', async (req, res) => {
  try {
    const notifications = await db.collection('notifications').find().toArray();
    res.status(200).json(notifications);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ message: 'Error fetching notifications' });
  }
});

// Endpoint to count students
app.get('/api/students/count', async (req, res) => {
  try {
    const count = await db.collection('Student_details').countDocuments();
    res.status(200).json({ count });
  } catch (error) {
    console.error('Error counting students:', error);
    res.status(500).json({ message: 'Error counting students' });
  }
});

// Endpoint to count notifications
app.get('/api/notifications/count', async (req, res) => {
  try {
    const count = await db.collection('notifications').countDocuments();
    res.status(200).json({ count });
  } catch (error) {
    console.error('Error counting notifications:', error);
    res.status(500).json({ message: 'Error counting notifications' });
  }
});

// Endpoint to count companies
app.get('/api/companies/count', async (req, res) => {
  try {
    const count = await db.collection('addcompany').countDocuments();
    res.status(200).json({ count });
  } catch (error) {
    console.error('Error counting companies:', error);
    res.status(500).json({ message: 'Error counting companies' });
  }
});

app.post('/api/updateprofile', async (req, res) => {
  const profileData = req.body;

  try {
    const result = await db.collection('Student_details').updateOne(
      { usn: profileData.usn }, // assuming registerNumber is used to identify the document
      { $set: profileData }
    );

    if (result.modifiedCount > 0) {
      res.status(200).json({ success: true, message: 'Profile updated successfully' });
    } else {
      res.status(404).json({ success: false, message: 'Profile not found or no changes made' });
    }
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ success: false, message: 'Error updating profile' });
  }
});
// Endpoint to fetch student applications for a specific company
//app.get('/api/applications/company/:companyName', (req, res) => {
  //const companyName = req.params.companyName;
  //console.log(`Fetching job applications for company: ${companyName}`);

  //db.collection('ApplyJob').find({ companyName: companyName }).toArray()
    //  .then(applications => {
      //    console.log('Applications fetched successfully:', applications);
        //  res.status(200).json(applications);
      //})
      //.catch(error => {
        //  console.error('Error fetching job applications:', error);
          //res.status(500).json({ message: 'Internal server error' });
      //});
//});
// In your login endpoint after successful authentication
let companyName = 'Edgeverve'; // Example company name

// Use a variable to store companyName during server runtime
app.post('/api/login', async (req, res) => {
  // Your login logic here
  companyName = companyDetails.companyName; // Set company name after successful login
});

// Retrieve companyName in your application
app.get('/api/applications/company/:companyName', (req, res) => {
  const companyName = req.params.companyName;
  console.log(`Fetching job applications for company: ${companyName}`);

  db.collection('ApplyJob').find({ companyName: companyName }).toArray()
      .then(applications => {
          console.log('Applications fetched successfully:', applications);
          res.status(200).json(applications);
      })
      .catch(error => {
          console.error('Error fetching job applications:', error);
          res.status(500).json({ message: 'Internal server error' });
      });
});

// After successful login
app.post('/api/login', async (req, res) => {
  // Your login logic here
  const { username, password, userType } = req.body;
  
  // Assuming company name is retrieved from db
  const companyDetails = await db.collection('addcompany').findOne({ companyName: username });
  
  if (companyDetails) {
      // Store companyName in session
      req.session.companyName = companyDetails.companyName;
      res.status(200).json({ message: 'Login successful', companyName: companyDetails.companyName });
  } else {
      res.status(401).json({ message: 'Invalid username or password' });
  }
});

// Retrieve companyName from session
app.get('/api/applications/company', (req, res) => {
  const companyName = req.session.companyName;
  console.log(`Fetching job applications for company: ${companyName}`);

  db.collection('ApplyJob').find({ companyName: companyName }).toArray()
      .then(applications => {
          console.log('Applications fetched successfully:', applications);
          res.status(200).json(applications);
      })
      .catch(error => {
          console.error('Error fetching job applications:', error);
          res.status(500).json({ message: 'Internal server error' });
      });
});

// Endpoint to fetch all job applications
app.get('/api/applications', (req, res) => {
  db.collection('ApplyJob').find().toArray()
    .then(applications => {
      console.log('Applications fetched successfully:', applications);
      res.status(200).json(applications);
    })
    .catch(error => {
      console.error('Error fetching job applications:', error);
      res.status(500).json({ message: 'Internal server error' });
    });
});


app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
